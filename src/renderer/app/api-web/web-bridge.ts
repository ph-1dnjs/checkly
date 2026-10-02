import type { ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

async function rpc(method: string, args: unknown[]) {
  const response = await fetch("/__api-testing", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Checkly-Dev": "1" },
    // JSON turns an omitted argument into null, which optional parameters reject (Electron IPC keeps undefined):
    // say which positions were omitted so the dev server restores them.
    body: JSON.stringify({ method, args, omitted: args.flatMap((arg, index) => arg === undefined ? [index] : []) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "개발 서버 연결 실패");
  return data.result;
}

function pickText(accept: string, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > limit) return reject(new Error("파일 크기 제한을 초과했습니다"));
      try { resolve(await file.text()); } catch { reject(new Error("파일을 읽지 못했습니다")); }
    };
    input.click();
  });
}

function download(filename: string, text: string, type: string): string {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}

export const webBridge: ApiTestingBridge = new Proxy({} as ApiTestingBridge, {
  get(_target, method: string) {
    // Files go through the browser here: the dev server only sees the text.
    if (method === "exportProject") return async (projectId: string) => {
      const text: string = await rpc("exportProject", [projectId]);
      const name = (JSON.parse(text) as { project: { name: string } }).project.name.replace(/[\\/:*?"<>|]/g, "_");
      return download(`${name}.checkly-api.json`, text, "application/json;charset=utf-8");
    };
    if (method === "readProjectFile") return () => pickText(".json", 10_000_000);
    if (method === "readScenarioFile") return () => pickText(".yaml,.yml", 1_000_000);
    if (method === "saveSuiteReport") return async (filename: string, html: string) => download(filename, html, "text/html;charset=utf-8");
    if (method === "getAiPrompt") return (request: unknown) => rpc("buildAiPrompt", [request]);
    if (method === "copyAiPrompt") return async (request: unknown) =>
      navigator.clipboard.writeText(await rpc("buildAiPrompt", [request]));
    if (method === "importSpec") return async (scope: unknown, source: { kind: string }) => {
      if (source.kind !== "file") return rpc(method, [scope, source]);
      const text = await pickText(".json,.yaml,.yml", 5_000_000);
      return text === null ? null : rpc("importText", [scope, text]);
    };
    return (...args: unknown[]) => rpc(method, args);
  },
});
