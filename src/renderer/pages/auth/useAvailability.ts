import { useEffect, useRef, useState } from "react";
import type { Availability } from "./model";

const DEBOUNCE_MS = 300;

/** 입력이 멈추면 서버에 사용 가능 여부를 묻는다. key가 null이면 묻지 않는다(형식이 틀린 입력). */
export const useAvailability = (key: string | null, check: (key: string) => Promise<boolean>): Availability => {
  const checkRef = useRef(check);
  checkRef.current = check;
  const [result, setResult] = useState<{ key: string; value: Exclude<Availability, null> } | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      checkRef.current(key).then(
        (available) => alive && setResult({ key, value: available ? "available" : "taken" }),
        () => alive && setResult({ key, value: "error" }),
      );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key]);

  if (!key) return null;
  return result?.key === key ? result.value : "checking";
};
