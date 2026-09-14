import { useEffect, useRef } from "react";

export type ApiRunAction = { run: () => void; disabled: boolean };
export type OnRunAction = (action: ApiRunAction | null) => void;

// Keep the common dock bound to the current panel without stale request values.
export function useRunAction(onChange: OnRunAction, run: () => void, disabled: boolean) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    onChange({ run: () => latest.current(), disabled });
    return () => onChange(null);
  }, [onChange, disabled]);
}
