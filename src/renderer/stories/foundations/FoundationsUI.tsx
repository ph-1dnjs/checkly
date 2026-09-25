import type { ReactNode } from "react";

export function Page({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="fd-page">
      <header className="fd-header">
        <h1 className="fd-title">{title}</h1>
        <p className="fd-desc">{desc}</p>
      </header>
      {children}
    </div>
  );
}

export function SectionBar({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="fd-bar">
      {label}
      <span className="fd-meta">{meta}</span>
    </div>
  );
}

export function Callout({ label, rules, warn }: { label: string; rules: string[]; warn?: boolean }) {
  return (
    <div className={warn ? "fd-callout fd-callout--warn" : "fd-callout"}>
      <div className={warn ? "fd-callout-bar fd-callout-bar--warn" : "fd-callout-bar"} />
      <div className="fd-callout-body">
        <div className="fd-callout-label">{label}</div>
        {rules.map((r) => (
          <p key={r}>{r}</p>
        ))}
      </div>
    </div>
  );
}
