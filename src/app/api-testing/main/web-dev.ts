import type { Plugin } from "vite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { ApiWorkspace, scopeSchema } from "./workspace";
import type { ApiScenarioInputRequest } from "../shared/workspace";
import { isProvidedScenarioInput, matchesScenarioInputType, type Json, type ScenarioInputRequest } from "../shared/scenario";
import { specSourceSchema } from "../shared/workspace";
import { SpecSync } from "./spec-sync";

// Explicit allowlist: never expose arbitrary workspace methods or filesystem paths.
const methods = [
  "listProjects", "saveProject", "getCatalog", "execute", "executeLive", "cancel",
  "listGlobals", "setGlobal", "deleteGlobal", "listScenarios", "previewScenario",
  "saveScenario", "saveScenarioDraft", "runScenario", "buildAiContext",
  "getRequestAuth", "setRequestAuth",
  "deleteProject", "deleteCatalog", "deleteScenario",
] as const;

export function apiWebDev(): Plugin {
  const workspace = new ApiWorkspace(path.resolve(".local/api-testing-web"));
  const sync = new SpecSync(path.resolve(".local/api-testing-web"), workspace, {
    available: () => false,
    encrypt: () => { throw new Error("웹 개발 모드는 계정 저장을 지원하지 않습니다"); },
    decrypt: () => { throw new Error("웹 개발 모드는 계정 저장을 지원하지 않습니다"); },
  });
  const inputScopeSchema = scopeSchema.omit({ serverId: true });
  const pendingInputs = new Map<string, {
    scope: z.infer<typeof inputScopeSchema>;
    request: ApiScenarioInputRequest;
    resolve: (value: Json | undefined) => void;
    timeout: NodeJS.Timeout;
  }>();
  const sameInputScope = (left: z.infer<typeof inputScopeSchema>, right: z.infer<typeof inputScopeSchema>) => left.projectId === right.projectId && left.environmentId === right.environmentId;
  const releasePending = (scope: z.infer<typeof inputScopeSchema>, runId?: string) => {
    for (const [requestId, pending] of pendingInputs) {
      if (!sameInputScope(pending.scope, scope) || (runId !== undefined && pending.request.runId !== runId)) continue;
      clearTimeout(pending.timeout); pendingInputs.delete(requestId); pending.resolve(undefined);
    }
  };
  const requestScenarioInput = (scope: z.infer<typeof inputScopeSchema>, request: ScenarioInputRequest): Promise<Json | undefined> => new Promise(resolve => {
    const requestId = randomUUID();
    const publicRequest: ApiScenarioInputRequest = { ...request, requestId };
    const timeout = setTimeout(() => {
      pendingInputs.delete(requestId); resolve(undefined);
    }, 300_000);
    pendingInputs.set(requestId, { scope, request: publicRequest, resolve, timeout });
  });
  return {
    name: "api-testing-local-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__api-testing", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        const origin = "http://127.0.0.1:5174";
        // Block cross-origin requests, DNS rebinding and form-based localhost writes.
        if (req.method !== "POST" || req.headers.host !== "127.0.0.1:5174" ||
            req.headers.origin !== origin || req.headers["x-checkly-dev"] !== "1" ||
            req.headers["content-type"] !== "application/json") {
          res.writeHead(403).end(JSON.stringify({ error: "허용되지 않은 개발 서버 요청" }));
          return;
        }
        try {
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            size += Buffer.byteLength(chunk);
            if (size > 8_000_000) throw new Error("요청은 8MB 이하만 지원합니다");
            chunks.push(Buffer.from(chunk));
          }
          const { method, args } = z.object({
            method: z.string(), args: z.array(z.unknown()).max(5),
          }).strict().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          let result: unknown;
          if (method === "runScenario") {
            const scope = inputScopeSchema.parse(args[0]);
            const runId = randomUUID();
            result = await workspace.runScenario(scope, z.string().max(1_000_000).parse(args[1]), z.record(z.string(), z.string()).parse(args[2]), z.record(z.string(), z.json()).parse(args[3]), {
              runId,
              requestInput: request => requestScenarioInput(scope, request),
            });
          } else if (method === "getPendingScenarioInput") {
            const scope = inputScopeSchema.parse(args[0]);
            result = [...pendingInputs.values()].find(pending => sameInputScope(pending.scope, scope))?.request ?? null;
          } else if (method === "submitScenarioInput") {
            const scope = inputScopeSchema.parse(args[0]);
            const submission = z.object({
              requestId: z.string().uuid(), runId: z.string().uuid(), stepId: z.string().min(1), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), value: z.json(),
            }).strict().parse(args[1]);
            const pending = pendingInputs.get(submission.requestId);
            if (!pending || !sameInputScope(pending.scope, scope) || pending.request.runId !== submission.runId || pending.request.stepId !== submission.stepId || pending.request.name !== submission.name) throw new Error("실행 중인 입력 요청이 아닙니다");
            if (pending.request.required && !isProvidedScenarioInput(submission.value)) throw new Error("필수 입력값을 입력하세요");
            if (isProvidedScenarioInput(submission.value) && !matchesScenarioInputType(submission.value, pending.request.type)) throw new Error("입력 형식이 설정된 타입과 다릅니다");
            clearTimeout(pending.timeout); pendingInputs.delete(submission.requestId); pending.resolve(submission.value); result = null;
          } else if (method === "cancel") {
            const scope = scopeSchema.parse(args[0]);
            workspace.cancel(scope); releasePending(scope); result = null;
          } else if (methods.includes(method as typeof methods[number])) {
            const action = workspace[method as typeof methods[number]] as (...values: unknown[]) => unknown;
            result = await action.apply(workspace, args);
          } else if (method === "importText") {
            const text = z.string().max(5_000_000).parse(args[1]);
            if (Buffer.byteLength(text) > 5_000_000) throw new Error("명세는 5MB 이하만 지원합니다");
            result = await workspace.importSpec(scopeSchema.parse(args[0]), text);
          } else if (method === "importSpec") {
            result = await sync.importUrl(scopeSchema.parse(args[0]), specSourceSchema.parse(args[1]));
          } else if (method === "getSpecSync") {
            result = await sync.get(scopeSchema.parse(args[0]));
          } else if (method === "deleteSpecAccount") {
            result = await sync.deleteAccount(scopeSchema.parse(args[0]));
          } else {
            throw new Error("지원하지 않는 작업입니다");
          }
          res.end(JSON.stringify({ result: result ?? null }));
        } catch (error) {
          // Validation payloads may contain credentials; do not serialize raw errors.
          const message = error instanceof z.ZodError || error instanceof SyntaxError ? "입력 형식을 확인하세요" :
            error instanceof Error && !error.message.includes("ENOENT") ? error.message : "개발 서버 작업 실패";
          res.writeHead(400).end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}
