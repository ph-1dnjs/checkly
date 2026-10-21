import { useId, useState, type ReactNode } from "react";
import { Button } from "../../shared/ui/Button";

export type SectionId = "account" | "team" | "endpoints" | "project" | "run" | "app";

const OPEN_KEY = "checkly.settings.open";

const readOpen = (): string[] | null => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "null");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
};

/**
 * 설정 아코디언의 펼침 상태(Checkly Settings v10). 한 번에 한 섹션만 펼치고,
 * "모두 펼치기"만 예외다. 마지막 상태는 이 PC에 기억한다.
 */
export const useOpenSections = (ids: SectionId[]) => {
  const [stored, setStored] = useState<string[]>(() => readOpen() ?? [ids[0]]);
  const open = ids.filter((id) => stored.includes(id));
  const save = (next: string[]) => {
    setStored(next);
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // 저장소를 못 쓰면 이번 실행에서만 기억한다.
    }
  };
  const allOpen = open.length === ids.length;
  return {
    isOpen: (id: SectionId) => open.includes(id),
    toggle: (id: SectionId) => save(open.includes(id) ? open.filter((item) => item !== id) : [id]),
    allOpen,
    toggleAll: () => save(allOpen ? [] : [...ids]),
  };
};

type SectionProps = {
  icon: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export const SettingsSection = ({ icon, title, open, onToggle, children }: SectionProps) => {
  const bodyId = useId();
  return (
    <section className="setting-section">
      <Button className="setting-section-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="msi setting-section-icon" aria-hidden="true">{icon}</span>
        <span className="setting-section-title">{title}</span>
        <span className="msi setting-section-caret" aria-hidden="true">{open ? "expand_less" : "expand_more"}</span>
      </Button>
      {open && (
        <div className="setting-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
};

/** 라벨 · 내용 · 동작 세 칸 행. */
export const SettingRow = ({ label, children, action, disabled }: { label: ReactNode; children?: ReactNode; action?: ReactNode; disabled?: boolean }) => (
  <div className="setting-row" aria-disabled={disabled || undefined}>
    <span className="setting-row-label">{label}</span>
    <div className="setting-row-body">{children}</div>
    <div className="setting-row-action">{action}</div>
  </div>
);

export const Switch = ({ on, onToggle, label, disabled }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) => (
  <Button className={`setting-switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle}>
    <i />
  </Button>
);

/** 행 아래에 붙는 확인 띠(되돌리기 어려운 변경 직전). */
export const InlineConfirm = ({ message, confirmLabel, danger, busy, onCancel, onConfirm }: {
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div className="setting-confirm" role="alertdialog" aria-label={typeof message === "string" ? message : confirmLabel}>
    <span className="setting-confirm-text">{message}</span>
    <Button variant="secondary" className="setting-chip" onClick={onCancel}>
      취소
    </Button>
    <Button variant={danger ? "danger" : "primary"} className="setting-chip" onClick={onConfirm} disabled={busy} aria-busy={busy} autoFocus>
      {confirmLabel}
    </Button>
  </div>
);

export const SavedNote = ({ text }: { text: string }) =>
  text ? (
    <span className="setting-saved" role="status">
      <span className="msi" aria-hidden="true">check_circle</span>
      {text}
    </span>
  ) : null;
