import { useEffect, useRef, useState } from "react";
import { Button } from "../shared/ui/Button";
import { Icon } from "../shared/ui/Icon";

const hostOf = (url: string) => {
  if (!url) return "";
  try { return new URL(url).host; } catch { return url; }
};

type Props = {
  endpoints: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** 각 서버 줄에 지금 환경의 주소를 보여 준다. */
  baseUrlFor: (endpointId: string) => string;
  disabled?: boolean;
};

/** 시나리오 편집·실행 헤더의 웹 엔드포인트(서버) 선택. 환경 메뉴(EnvironmentMenu)와 같은 모양이다. */
export function EndpointPicker({ endpoints, value, onChange, label, baseUrlFor, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = endpoints.find(item => item.id === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className="api-env-menu">
    <Button ref={trigger} className="api-env-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} title={current ? `${current.name} 서버` : undefined} disabled={disabled || !endpoints.length} onClick={() => setOpen(!open)}>
      <span className="api-env-current">{current?.name ?? (endpoints.length ? "서버 선택" : "등록된 웹 사이트 없음")}</span><Icon name="expand_more" size={16} />
    </Button>
    {open && <div role="menu" aria-label="서버 선택" className="api-env-popup">
      {endpoints.map(item => <Button key={item.id} role="menuitemradio" aria-checked={item.id === value} className="api-env-item" onClick={() => { setOpen(false); onChange(item.id); trigger.current?.focus(); }}>
        <Icon name="check" size={16} className="api-env-check" />
        <span className="api-env-name">{item.name}</span>
        <span className="api-env-host">{hostOf(baseUrlFor(item.id))}</span>
      </Button>)}
    </div>}
  </div>;
}
