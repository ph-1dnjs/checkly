import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { AuthBridge, ResetAccount } from "../../shared/model/electron-api/auth";
import { AuthFlowLayout, FlowHeading } from "./AuthFlowLayout";
import { AuthError, AuthInput, Field, InfoTable, PasswordInput } from "./AuthFields";
import { errorMessage, normalizeResetCode, passwordError, PASSWORD_MIN, RESET_CODE_PATTERN } from "./model";

type Props = {
  bridge: AuthBridge;
  backLabel: string;
  onBack: () => void;
  /** 변경을 마치고 "로그인하러 가기"를 누르면 그 계정을 로그인 화면에 채운다. */
  onDone: (account: { projectCode: string; nickname: string }) => void;
};

const STEPS = ["계정 확인", "재설정 코드", "새 비밀번호", "완료"];

/** 비밀번호 찾기: 계정 확인 → 관리자가 발급한 재설정 코드 → 새 비밀번호 → 완료. 가상 이메일이라 메일 재설정은 없다. */
export const ResetFlow = ({ bridge, backLabel, onBack, onDone }: Props) => {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [account, setAccount] = useState<ResetAccount | null>(null);
  const [resetCode, setResetCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (next: number) => {
    setError("");
    setStep(next);
  };
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError("");
  };

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitAccount = (event: FormEvent) => {
    event.preventDefault();
    const projectCode = code.trim();
    const nick = nickname.trim();
    if (!projectCode || !nick) return setError("프로젝트 코드와 닉네임을 입력하세요.");
    void run(async () => {
      setAccount(await bridge.findResetAccount({ projectCode, nickname: nick }));
      go(2);
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (!account) return;
    if (!RESET_CODE_PATTERN.test(resetCode)) return setError("재설정 코드는 6자리 숫자입니다.");
    void run(async () => {
      await bridge.verifyResetCode({ projectCode: account.projectCode, nickname: account.nickname, code: resetCode });
      go(3);
    });
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!account) return;
    const problem = passwordError(password, confirm);
    if (problem) return setError(problem);
    void run(async () => {
      await bridge.resetPassword({ projectCode: account.projectCode, nickname: account.nickname, code: resetCode, password });
      go(4);
    });
  };

  return (
    <AuthFlowLayout
      screenLabel="시작 · 비밀번호 찾기"
      steps={STEPS}
      current={step}
      backLabel={step === 4 ? null : backLabel}
      onBack={onBack}
    >
      {step === 1 && (
        <>
          <FlowHeading title="비밀번호 찾기" description="로그인할 때 쓰는 프로젝트 코드와 닉네임을 입력해주세요." />
          <form className="auth-form" onSubmit={submitAccount} noValidate>
            <Field label="프로젝트 코드">
              <AuthInput
                mono
                value={code}
                onValue={edit((value) => setCode(value.toLowerCase()))}
                placeholder="checkly-team"
                aria-label="프로젝트 코드"
                autoFocus={!code}
              />
            </Field>
            <Field label="닉네임" className="auth-field-gap">
              <AuthInput mono value={nickname} onValue={edit(setNickname)} placeholder="닉네임 입력" aria-label="닉네임" autoFocus={Boolean(code)} />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button variant="secondary" size="large" className="auth-btn" onClick={onBack}>
                취소
              </Button>
              <Button type="submit" variant="primary" size="large" className="auth-btn" disabled={busy} aria-busy={busy}>
                다음
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 2 && account && (
        <>
          <FlowHeading
            title="재설정 코드 입력"
            description="프로젝트 관리자에게 재설정 코드를 받아 입력해주세요. 관리자는 설정 > 멤버에서 코드를 발급합니다."
          />
          <form className="auth-form" onSubmit={submitCode} noValidate>
            <InfoTable
              label="재설정할 계정"
              rows={[
                ["프로젝트 코드", account.projectCode],
                ["관리자", account.ownerNickname],
              ]}
            />
            <Field label="재설정 코드" className="auth-field-gap">
              <AuthInput
                mono
                className="auth-reset-code"
                value={resetCode}
                onValue={edit((value) => setResetCode(normalizeResetCode(value)))}
                placeholder="6자리 숫자"
                aria-label="재설정 코드"
                inputMode="numeric"
                maxLength={6}
                autoFocus
              />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button variant="secondary" size="large" className="auth-btn" onClick={() => go(1)}>
                이전
              </Button>
              <Button type="submit" variant="primary" size="large" className="auth-btn" disabled={busy} aria-busy={busy}>
                다음
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 3 && account && (
        <>
          <div className="auth-flow-heading">
            <h2>새 비밀번호</h2>
            <p>
              <span className="auth-mono-strong">{account.nickname}</span> 계정에서 사용할 새 비밀번호를 입력해주세요.
            </p>
          </div>
          <form className="auth-form" onSubmit={submitPassword} noValidate>
            <Field label="새 비밀번호">
              <PasswordInput
                mono
                value={password}
                onValue={edit(setPassword)}
                placeholder={`${PASSWORD_MIN}자 이상`}
                aria-label="새 비밀번호"
                subject="새 비밀번호"
                autoComplete="new-password"
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                autoFocus
              />
            </Field>
            <Field label="새 비밀번호 확인" className="auth-field-gap">
              <AuthInput
                mono
                type={showPassword ? "text" : "password"}
                value={confirm}
                onValue={edit(setConfirm)}
                placeholder="한 번 더 입력"
                aria-label="새 비밀번호 확인"
                autoComplete="new-password"
              />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button variant="secondary" size="large" className="auth-btn" onClick={() => go(2)}>
                이전
              </Button>
              <Button type="submit" variant="primary" size="large" className="auth-btn" disabled={busy} aria-busy={busy}>
                {busy ? "변경하는 중…" : "비밀번호 변경"}
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 4 && account && (
        <>
          <FlowHeading done title="비밀번호를 변경했습니다" description="새 비밀번호로 로그인해주세요." />
          <Button
            variant="primary"
            size="large"
            className="auth-btn"
            onClick={() => onDone({ projectCode: account.projectCode, nickname: account.nickname })}
            autoFocus
          >
            로그인하러 가기
          </Button>
        </>
      )}
    </AuthFlowLayout>
  );
};
