import { useCallback, useEffect, useState } from "react";

const storageKey = "checkly:api-globals-show-values";
const changed = "checkly:api-globals-show-values";

const read = () => { try { return localStorage.getItem(storageKey) === "1"; } catch { return false; } };

/**
 * Whether global variable values are shown (hidden by default, for screen sharing). Shared by the
 * globals panel and the "new global" field in value links; remembered on this device.
 */
export function useGlobalValuesVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState(read);
  useEffect(() => {
    const sync = () => setVisible(read());
    window.addEventListener(changed, sync);
    return () => window.removeEventListener(changed, sync);
  }, []);
  const toggle = useCallback(() => {
    try { localStorage.setItem(storageKey, read() ? "0" : "1"); } catch { /* Falls back to this view only. */ }
    setVisible(value => !value);
    window.dispatchEvent(new Event(changed));
  }, []);
  return [visible, toggle];
}
