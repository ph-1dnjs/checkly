import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcEnvironment, AiTcModel } from "../../app/hooks/useAiTc";
import { hostOf } from "../../../app/ipc/ai-tc/model";

type Menu = "endpoint" | "env" | "local" | "";

/** 헤더 오른쪽 엔드포인트 · 환경 선택. 로컬 모드(Supabase 설정 없음)는 시작 URL을 직접 적는다. */
export const EnvPicker = ({ model, environment }: { model: AiTcModel; environment: AiTcEnvironment | null }) => {
  const [menu, setMenu] = useState<Menu>("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const toggle = (next: Menu) => setMenu(current => (current === next ? "" : next));

  const trigger = (key: Menu, label: string) => (
    <Button className={`aitcx-select${menu === key ? " open" : ""}`} aria-haspopup="listbox" aria-expanded={menu === key} disabled={model.live} onClick={() => toggle(key)}>
      {label}<span className="msi" aria-hidden="true">expand_more</span>
    </Button>
  );
  const option = (key: string, label: string, sub: string, on: boolean, go: () => void) => (
    <Button key={key} role="option" aria-selected={on} className={`aitcx-option${on ? " on" : ""}`} onClick={() => { go(); setMenu(""); }}>
      <span className="msi" aria-hidden="true">check</span><span>{label}</span><small>{sub}</small>
    </Button>
  );

  if (!environment) {
    return (
      <div className="aitcx-env" ref={root}>
        <span className="aitcx-env-name">로컬</span>
        <div className="aitcx-pop-anchor">
          {trigger("local", hostOf(model.localUrl.trim()) || "시작 URL")}
          {/* 디자인 미반영(로컬 개발 실행용으로 임시 유지): 시작 URL · 추가 허용 도메인 입력 */}
          {menu === "local" && (
            <div className="aitcx-pop form">
              <label><span>시작 URL · 로컬 모드</span><Input mono value={model.localUrl} placeholder="https://qa.example.com" onChange={event => model.setLocalUrl(event.target.value)} /></label>
              <label><span>추가 허용 도메인</span><Input mono value={model.localHosts} placeholder="www.example.com, m.example.com" onChange={event => model.setLocalHosts(event.target.value)} /></label>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="aitcx-env" ref={root}>
      <div className="aitcx-pop-anchor">
        {trigger("endpoint", model.endpointName || "엔드포인트 없음")}
        {menu === "endpoint" && (
          <div className="aitcx-pop" role="listbox" aria-label="엔드포인트">
            {environment.endpoints.map(item => option(item.id, item.name, hostOf(environment.baseUrlFor(item.id)), item.id === environment.endpointId, () => void environment.select({ endpointId: item.id })))}
            {!environment.endpoints.length && <div className="aitcx-pop-empty">등록된 웹 엔드포인트 없음</div>}
          </div>
        )}
      </div>
      <div className="aitcx-pop-anchor">
        {trigger("env", model.environmentName)}
        {menu === "env" && (
          <div className="aitcx-pop" role="listbox" aria-label="환경">
            {environment.environments.map(item => option(item.id, item.name, item.id === environment.environmentId ? hostOf(model.startUrl) : "", item.id === environment.environmentId, () => void environment.select({ environmentId: item.id })))}
          </div>
        )}
      </div>
      {/* 디자인 미반영: 허용 도메인 목록 표시(model.allowedHosts), 운영 환경 주의 안내 */}
    </div>
  );
};
