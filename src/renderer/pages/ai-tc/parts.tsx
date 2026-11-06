import type { ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcLiveVerdict } from "../../../app/ipc/ai-tc/model";

/** 대화 패널 디자인(Checkly AI TC 대화 패널 · 시안 4a)의 상태 색 */
export type Tone = "ok" | "fail" | "warn" | "run" | "wait";

export const TONE_ICON: Record<Tone, string> = { ok: "check_circle", fail: "cancel", warn: "error", run: "progress_activity", wait: "radio_button_unchecked" };

export const toneOf = (verdict: AiTcLiveVerdict): Tone =>
  ({ pass: "ok", fail: "fail", blocked: "warn", check: "warn", pending: "wait", na: "wait", running: "run", waiting: "warn" } as const)[verdict];

export const VERDICT_TEXT: Record<AiTcLiveVerdict, string> = {
  pass: "통과", fail: "실패", blocked: "Blocked", check: "확인 필요", pending: "미실행", na: "N/A", running: "실행 중", waiting: "대기",
};

export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

export const groupOf = (item: { scenarioId?: string; id: string }) => item.scenarioId || item.id.replace(/-?TC\d+$/i, "") || "ID 없음";

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback;

/** 16px 체크 상자. part는 일부 선택(−). */
export const Check = ({ on, part, label, onToggle, disabled }: { on: boolean; part?: boolean; label: string; onToggle: () => void; disabled?: boolean }) => (
  <Button role="checkbox" aria-checked={on ? true : part ? "mixed" : false} aria-label={label} disabled={disabled}
    className={`aitcx-check${on ? " on" : part ? " part" : ""}`} onClick={onToggle}>
    <span className="msi" aria-hidden="true">{on ? "check" : part ? "remove" : ""}</span>
  </Button>
);

export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`aitcx-badge t-${tone}`}>{children}</span>;

/** 펼침 아이콘이 붙은 상태 배지(행 상세 열기) */
export const BadgeToggle = ({ tone, open, onToggle, children }: { tone: Tone; open: boolean; onToggle: () => void; children: ReactNode }) => (
  <Button className={`aitcx-badge t-${tone} is-toggle`} aria-expanded={open} onClick={onToggle}>
    {children}<span className="msi" aria-hidden="true">{open ? "expand_less" : "expand_more"}</span>
  </Button>
);

export type ChipItem<K extends string> = { key: K; label: string; count: number };

/** 작업 영역 상단: 제목 · 필터 칩 · 표시 개수 · 검색 */
export function WorkHead<K extends string>({ title, sub, action, chips, filter, onFilter, extra, shown, query, onQuery }: {
  title: string; sub: string; action?: ReactNode; chips: Array<ChipItem<K>>; filter: K; onFilter: (key: K) => void;
  extra?: ReactNode; shown: number; query: string; onQuery: (value: string) => void;
}) {
  return (
    <>
      <div className="aitcx-ws-title"><strong>{title}</strong><span>{sub}</span>{action}</div>
      {extra}
      <div className="aitcx-ws-tools">
        {chips.map(chip => (
          <Button key={chip.key} aria-pressed={filter === chip.key} className={`aitcx-chip${filter === chip.key ? " on" : ""}`} onClick={() => onFilter(chip.key)}>
            {chip.label}<b>{chip.count}</b>
          </Button>
        ))}
        <span className="aitcx-shown">{shown}개 표시</span>
        <Input wrapperClassName="aitcx-search" aria-label="TC 검색" placeholder="ID·TC명·시나리오 검색" value={query} onChange={event => onQuery(event.target.value)}
          leading={<span className="msi" aria-hidden="true">search</span>} />
      </div>
    </>
  );
}

export const matches = (query: string, item: { id: string; title: string; scenarioId?: string }) => {
  const q = query.trim().toLowerCase();
  return !q || item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q) || groupOf(item).toLowerCase().includes(q);
};

export const caseGroups = <T extends { scenarioId?: string; id: string }>(items: T[]) => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
  return [...groups.entries()];
};
