import { useCallback, useEffect, useState } from "react";

const storageKey = "checkly:api-globals-show-values";
const changed = "checkly:api-globals-show-values";

const read = () => { try { return localStorage.getItem(storageKey) === "1"; } catch { return false; } };
// The current choice for this window, so it still toggles (for this session) when storage is unavailable.
let current: boolean | null = null;

/**
 * Whether global variable values are shown (hidden by default, for screen sharing). Shared by the
 * globals panel and the "new global" field in value links; remembered on this device.
 */
export function useGlobalValuesVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState(() => current ?? read());
  useEffect(() => {
    const sync = () => setVisible(current ?? read());
    window.addEventListener(changed, sync);
    return () => window.removeEventListener(changed, sync);
  }, []);
  const toggle = useCallback(() => {
    current = !(current ?? read());
    try { localStorage.setItem(storageKey, current ? "1" : "0"); } catch { /* Kept for this session only. */ }
    window.dispatchEvent(new Event(changed));
  }, []);
  return [visible, toggle];
}
