import type { ReactNode } from "react";
import type { SpecRow } from "./tokens";

export { Page, SectionBar, Callout } from "../foundations/FoundationsUI";

export function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="msi" style={{ fontSize: size, color }}>
      {name}
    </span>
  );
}

export function Demo({ children }: { children: ReactNode }) {
  return <div className="cp-demo">{children}</div>;
}

export function SpecTable({ rows }: { rows: SpecRow[] }) {
  return (
    <div className="cp-spec">
      {rows.map((r) => (
        <div className="cp-spec-row" key={r.token}>
          <span className="cp-spec-token">{r.token}</span>
          <span className="cp-spec-value">{r.value}</span>
          <span className="cp-spec-use">{r.use}</span>
        </div>
      ))}
    </div>
  );
}
