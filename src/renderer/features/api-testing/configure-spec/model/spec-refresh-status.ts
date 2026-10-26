import type { ApiCatalog, ApiSpecSync } from "../../../../../app/api-testing/shared/workspace";

export function specRefreshStatus(catalog: Pick<ApiCatalog, "importedAt"> | null, sync: ApiSpecSync | null, loading: boolean, refreshing: boolean, error: string, now = Date.now()) {
  const importedAt = catalog?.importedAt;
  let age = "";
  if (importedAt && Number.isFinite(Date.parse(importedAt))) {
    const minutes = Math.max(0, Math.floor((now - Date.parse(importedAt)) / 60_000));
    age = minutes === 0 ? "방금" : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`;
  }
  if (loading) return { tone: "loading", text: refreshing ? "갱신 중…" : "문서 읽는 중…", detail: "" };
  if (error || sync?.status === "failed") return { tone: "warn", text: "갱신 실패", detail: catalog ? "이전 문서 사용 중" : "등록 필요" };
  if (!catalog) return { tone: "warn", text: "등록 필요", detail: "" };
  return { tone: "idle", text: age ? `${age} 동기화` : "동기화 시각 없음", detail: sync?.url ? "" : "파일 문서" };
}

export const isProductionEnvironment = (name: string) => /^(prod(?:uction)?|운영)$/i.test(name.trim());

/** Deleting a remembered account may remove its username, while the form still requires Basic auth. */
export const specRefreshNeedsSettings = (sync: ApiSpecSync | null, authKind: string) => !sync?.url || Boolean((sync.username || authKind === "basic") && !sync.hasSavedAccount);
