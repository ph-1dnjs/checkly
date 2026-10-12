import type { ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import checklyMark from "../../assets/checkly-mark.png";
import { Wordmark } from "./AuthFields";

type Props = {
  screenLabel: string;
  steps: string[];
  current: number;
  /** 완료 단계에서는 이미 로그인된 상태라 뒤로 가기를 숨긴다. */
  backLabel: string | null;
  onBack: () => void;
  children: ReactNode;
};

/** 초대코드 가입·새 프로젝트 공통 틀: 상단 바 + 왼쪽 단계 표시 + 오른쪽 내용. */
export const AuthFlowLayout = ({ screenLabel, steps, current, backLabel, onBack, children }: Props) => (
  <section className="auth-flow" data-screen-label={screenLabel}>
    <header className="auth-flow-bar">
      {backLabel && (
        <>
          <Button className="auth-flow-back" onClick={onBack} aria-label={`${backLabel}으로 돌아가기`}>
            <span className="msi" aria-hidden="true">chevron_left</span>
            {backLabel}
          </Button>
          <i className="auth-flow-bar-rule" />
        </>
      )}
      <img src={checklyMark} alt="Checkly 마크" />
      <Wordmark className="small" />
    </header>
    <div className="auth-flow-body">
      <div className="auth-flow-columns">
        <ol className="auth-steps" aria-label="진행 단계">
          {steps.map((label, index) => {
            const n = index + 1;
            const state = n < current ? "done" : n === current ? "current" : "todo";
            return (
              <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                <div className="auth-step">
                  <span className="auth-step-dot">{state === "done" ? "✓" : n}</span>
                  <span className="auth-step-label">{label}</span>
                </div>
                {index < steps.length - 1 && <span className="auth-step-line" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
        <div className="auth-flow-content">{children}</div>
      </div>
    </div>
  </section>
);

export const FlowHeading = ({ title, description, done }: { title: string; description: string; done?: boolean }) => (
  <div className="auth-flow-heading">
    {done && (
      <span className="msi auth-done-icon" aria-hidden="true">
        check_circle
      </span>
    )}
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
);
