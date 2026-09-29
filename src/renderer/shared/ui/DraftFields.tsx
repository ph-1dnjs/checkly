// Inputs that keep a local draft while the parent value is re-derived from the scenario.
import { useEffect, useState, type ComponentProps } from "react";

export function DraftInput({ value, onChange, ...props }: ComponentProps<"input">) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <input {...props} value={text} onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}

export function DraftTextarea({ value, onChange, ...props }: ComponentProps<"textarea">) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <textarea {...props} value={text} onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}
