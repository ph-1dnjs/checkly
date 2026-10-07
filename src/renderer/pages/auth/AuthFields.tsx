import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { copyText, type FieldCheck } from "./model";

export const Wordmark = ({ className }: { className?: string }) => (
  <span className={["auth-wordmark", className].filter(Boolean).join(" ")}>
    Check<span>ly</span>
  </span>
);

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onValue: (value: string) => void;
};

/** 프로젝트 코드·닉네임처럼 철자 그대로 쓰는 값. */
export const AuthInput = ({ onValue, className, ...rest }: InputProps) => (
  <input
    className={["auth-input", className].filter(Boolean).join(" ")}
    autoComplete="off"
    spellCheck={false}
    onChange={(event) => onValue(event.target.value)}
    {...rest}
  />
);

/** 표시/숨기기 버튼이 붙은 비밀번호 입력. visible은 같은 폼의 확인 칸과 공유한다. */
export const PasswordInput = ({
  visible,
  onToggle,
  ...rest
}: Omit<InputProps, "type"> & { visible: boolean; onToggle: () => void }) => (
  <div className="auth-password">
    <AuthInput type={visible ? "text" : "password"} autoComplete="current-password" {...rest} />
    <Button className="auth-password-toggle" onClick={onToggle} aria-pressed={visible} aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}>
      {visible ? "숨기기" : "표시"}
    </Button>
  </div>
);

export const Field = ({ label, check, className, children }: { label: string; check?: FieldCheck; className?: string; children: ReactNode }) => (
  <div className={className}>
    <div className="auth-field-label">{label}</div>
    {children}
    {check && (
      <div className="auth-field-check" data-tone={check.tone} aria-live="polite">
        {check.text}
      </div>
    )}
  </div>
);

export const AuthError = ({ message }: { message: string }) =>
  message ? (
    <div className="auth-error" role="alert">
      <span className="msi" aria-hidden="true">error</span>
      {message}
    </div>
  ) : null;

export const InfoTable = ({ rows, label }: { rows: Array<[string, ReactNode]>; label?: string }) => (
  <dl className="auth-info" aria-label={label}>
    {rows.map(([name, value]) => (
      <div key={name} className="auth-info-row">
        <dt>{name}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
);

/** 복사 후 1.6초간 "복사됨"으로 바뀐다. */
export const CopyButton = ({ value, label = "복사", className, subject }: { value: string; label?: string; className?: string; subject?: string }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      className={["copy-button", className].filter(Boolean).join(" ")}
      aria-label={subject ? `${subject} ${copied ? "복사됨" : label}` : undefined}
      disabled={!value}
      onClick={async () => {
        if (!(await copyText(value))) return;
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      <span className="msi" aria-hidden="true">{copied ? "check" : "content_copy"}</span>
      {copied ? "복사됨" : label}
    </Button>
  );
};
