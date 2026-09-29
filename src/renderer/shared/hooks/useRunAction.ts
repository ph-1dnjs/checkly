import type { OnRunAction } from "../model/run-action";
import { useEffect, useRef } from "react";


// Keep the common dock bound to the current panel without stale request values.
export function useRunAction(onChange: OnRunAction, run: () => void, disabled: boolean, label?: string) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    onChange({ run: () => latest.current(), disabled, label });
    return () => onChange(null);
  }, [onChange, disabled, label]);
}
