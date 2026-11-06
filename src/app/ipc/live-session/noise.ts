// Image failures are visible in the page, but do not warrant an error replay.
// Keep navigation, script failures and application console errors actionable.
export const isImageLoadingEvent = (event: Record<string, unknown>): boolean => {
  if (!["resource-error", "fetch", "xhr", "console-error"].includes(String(event.type))) return false;
  if (event.resourceType === "document") return false;
  if (event.type === "console-error" && event.browserResourceError !== true) return false;
  if (event.type === "resource-error" && String(event.element).toUpperCase() === "IMG") return true;
  if (event.resourceType === "image") return true;
  try {
    const url = new URL(String(event.url || ""), String(event.pageUrl || "https://checkly.local"));
    if (["fetch", "xhr"].includes(String(event.type))) {
      return ["GET", "HEAD"].includes(String(event.method || "GET").toUpperCase())
        && /(?:^|\/)_next\/image\/?$/.test(url.pathname);
    }
    return /(?:^|\/)_next\/image\/?$/.test(url.pathname)
      || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname);
  } catch { return false; }
};
