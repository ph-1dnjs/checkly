import type { ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

async function rpc(method: string, args: unknown[]) {
  const response = await fetch("/__api-testing", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Checkly-Dev": "1" },
    body: JSON.stringify({ method, args }),
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

export const webBridge: ApiTestingBridge = new Proxy({} as ApiTestingBridge, {
  get(_target, method: string) {
    if (method === "readScenarioFile") return () => pickText(".yaml,.yml", 1_000_000);
    if (method === "copyAiContext") return async (request: unknown) =>
      navigator.clipboard.writeText(await rpc("buildAiContext", [request]));
    if (method === "importSpec") return async (scope: unknown, source: { kind: string }) => {
      if (source.kind !== "file") return rpc(method, [scope, source]);
      const text = await pickText(".json,.yaml,.yml", 5_000_000);
      return text === null ? null : rpc("importText", [scope, text]);
    };
    return (...args: unknown[]) => rpc(method, args);
  },
});
