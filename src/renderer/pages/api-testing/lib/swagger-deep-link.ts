// Keeps Swagger tag/operation expansion in sync with the URL hash.
import { type MouseEvent } from "react";
import { type SwaggerSystem, type SwaggerDeepLinkKey } from "../model/swagger-types";

export function deepLinkHash(key: SwaggerDeepLinkKey, shown: boolean): string {
  if (!shown) return "#/";
  if (key[0] === "operations-tag") return `#/${encodeURIComponent(key[1])}`;
  return `#/${encodeURIComponent(key[1])}/${encodeURIComponent(key[2])}`;
}

export function deepLinkKeyFromHash(hash: string): SwaggerDeepLinkKey | undefined {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(part => {
    try { return decodeURIComponent(part); }
    catch { return part; }
  });
  if (parts[0] === "operations-tag" && parts[1]) return ["operations-tag", parts[1]];
  if (parts[0] === "operations" && parts[1] && parts[2]) return ["operations", parts[1], parts[2]];
  if (parts[0] && parts[1]) return ["operations", parts[0], parts.slice(1).join("/")];
  if (parts[0]) return ["operations-tag", parts[0]];
  return undefined;
}

export function updateDeepLinkHash(key: unknown, shown: unknown): void {
  if (!Array.isArray(key) || typeof shown !== "boolean") return;
  const [kind, tag, operationId] = key;
  if (kind !== "operations-tag" && kind !== "operations") return;
  const hash = deepLinkHash(
    kind === "operations-tag"
      ? ["operations-tag", String(tag)]
      : ["operations", String(tag), String(operationId)],
    shown,
  );
  if (window.location.hash === hash) return;
  try {
    if (window.history && typeof window.history.pushState === "function") {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    } else {
      window.location.hash = hash.slice(1);
    }
  } catch {
    window.location.hash = hash.slice(1);
  }
}

export function scrollToDeepLink(key: SwaggerDeepLinkKey): void {
  const root = document.querySelector(".api-swagger-renderer");
  if (!root) return;
  const target = key[0] === "operations-tag"
    ? [...root.querySelectorAll<HTMLElement>(".opblock-tag")].find(element => element.dataset.tag === key[1])
    : [...root.querySelectorAll<HTMLElement>(".opblock")].find(element =>
      element.dataset.checklyDeepLinkTag === key[1] && element.dataset.checklyDeepLinkOperation === key[2]);
  target?.scrollIntoView({ block: "start" });
}

export function applyDeepLink(system: SwaggerSystem | null, hash: string): void {
  const key = deepLinkKeyFromHash(hash);
  if (!key || !system) return;
  system.layoutActions.show(key, true);
  window.setTimeout(() => scrollToDeepLink(key), 0);
}

export function handleSwaggerClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".api-rich-description")) return;
  const operationPath = target.closest<HTMLElement>(".opblock-summary-path, .opblock-summary-path__deprecated");
  if (operationPath) {
    const operation = operationPath.closest<HTMLElement>(".opblock");
    const tag = operation?.dataset.checklyDeepLinkTag;
    const operationId = operation?.dataset.checklyDeepLinkOperation;
    if (tag && operationId) updateDeepLinkHash(["operations", tag, operationId], !operation?.classList.contains("is-open"));
    return;
  }
  const tagElement = target.closest<HTMLElement>(".opblock-tag");
  const tag = tagElement?.dataset.tag;
  if (tag) updateDeepLinkHash(["operations-tag", tag], tagElement?.dataset.isOpen !== "true");
}
