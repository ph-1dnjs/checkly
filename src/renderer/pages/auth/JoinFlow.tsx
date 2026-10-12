import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { AuthBridge, AuthSession, InvitePreview } from "../../shared/model/electron-api/auth";
import { AuthFlowLayout, FlowHeading } from "./AuthFlowLayout";
import { AuthError, AuthInput, Field, InfoTable, PasswordInput } from "./AuthFields";
import {
  completeInvite,
  errorMessage,
  fieldCheck,
  formatDate,
  INVALID_INVITE,
  INVITE_PATTERN,
  NICKNAME_HINT,
  NICKNAME_PATTERN,
  normalizeInvite,
  passwordError,
  PASSWORD_MIN,
} from "./model";
import { useAvailability } from "./useAvailability";

type Props = {
  bridge: AuthBridge;
  backLabel: string;
  onBack: () => void;
  onEnter: (session: AuthSession) => void;
};

const STEPS = ["초대코드", "프로젝트 확인", "계정 설정", "완료"];

export const JoinFlow = ({ bridge, backLabel, onBack, onEnter }: Props) => {
  const [step, setStep] = useState(1);
  const [invite, setInvite] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const nick = nickname.trim();
  const inviteCode = completeInvite(invite);
  const nickAvailability = useAvailability(step === 3 && NICKNAME_PATTERN.test(nick) ? nick : null, (value) =>
    bridge.isNicknameAvailable(inviteCode, value),
  );
  const nickCheck = fieldCheck(nick, NICKNAME_PATTERN, NICKNAME_HINT, nickAvailability, {
    taken: "이 프로젝트에서 이미 쓰는 닉네임입니다",
    available: "사용할 수 있는 닉네임입니다",
  });

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

  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    if (!inviteCode) return setError("초대코드를 입력하세요.");
    if (!INVITE_PATTERN.test(inviteCode)) return setError(INVALID_INVITE);
    void run(async () => {
      const found = await bridge.previewInvite(inviteCode);
      if (!found) return setError(INVALID_INVITE);
      setInvite(inviteCode);
      setPreview(found);
      go(2);
    });
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!nickCheck.ok) return setError(nick ? `${nickCheck.text}.` : "닉네임을 입력하세요.");
    const passwordProblem = passwordError(password, confirm);
    if (passwordProblem) return setError(passwordProblem);
    void run(async () => {
      setSession(await bridge.joinProject({ inviteCode, nickname: nick, password }));
      go(4);
    });
  };

  return (
    <AuthFlowLayout
      screenLabel="시작 · 초대코드 가입"
      steps={STEPS}
      current={step}
      backLabel={step === 4 ? null : backLabel}
      onBack={onBack}
    >
      {step === 1 && (
        <>
          <FlowHeading title="초대코드 입력" description="팀에서 받은 초대코드를 입력해주세요." />
          <form className="auth-form" onSubmit={submitInvite} noValidate>
            <Field label="초대코드">
              <AuthInput
                className="mono"
                value={invite}
                onValue={edit((value) => setInvite(normalizeInvite(value)))}
                placeholder="XXX-XXXXXX"
                aria-label="초대코드"
                maxLength={12}
                autoFocus
              />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button className="auth-btn auth-btn-secondary" onClick={onBack}>
                취소
              </Button>
              <Button type="submit" className="auth-btn auth-btn-primary" disabled={busy} aria-busy={busy}>
                다음
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 2 && preview && (
        <>
          <FlowHeading title="프로젝트 확인" description="아래 프로젝트에 멤버로 가입합니다." />
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              go(3);
            }}
          >
            <InfoTable
              label="가입할 프로젝트"
              rows={[
                ["프로젝트 코드", preview.projectCode],
                ["관리자", preview.ownerNickname],
                ["팀원", `${preview.memberCount}명`],
                ["만든 날", formatDate(preview.createdAt)],
              ]}
            />
            <div className="auth-actions">
              <Button className="auth-btn auth-btn-secondary" onClick={() => go(1)}>
                이전
              </Button>
              <Button type="submit" className="auth-btn auth-btn-primary" autoFocus>
                이 프로젝트에 가입
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 3 && (
        <>
          <FlowHeading title="계정 설정" description="프로젝트에서 사용할 영문 닉네임과 비밀번호를 입력해주세요." />
          <form className="auth-form" onSubmit={submitJoin} noValidate>
            <Field label="닉네임" check={nickCheck}>
              <AuthInput className="mono" value={nickname} onValue={edit(setNickname)} placeholder="hyewon" aria-label="닉네임" autoFocus />
            </Field>
            <Field label="비밀번호">
              <PasswordInput
                className="mono"
                value={password}
                onValue={edit(setPassword)}
                placeholder={`${PASSWORD_MIN}자 이상`}
                aria-label="비밀번호"
                autoComplete="new-password"
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
              />
            </Field>
            <Field label="비밀번호 확인" className="auth-field-gap">
              <AuthInput
                className="mono"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onValue={edit(setConfirm)}
                placeholder="한 번 더 입력"
                aria-label="비밀번호 확인"
                autoComplete="new-password"
              />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button className="auth-btn auth-btn-secondary" onClick={() => go(2)}>
                이전
              </Button>
              <Button type="submit" className="auth-btn auth-btn-primary" disabled={busy} aria-busy={busy}>
                {busy ? "가입하는 중…" : "가입하기"}
              </Button>
            </div>
          </form>
        </>
      )}

      {step === 4 && session && (
        <>
          <FlowHeading done title="가입 완료" description="다음부터는 아래 정보로 로그인합니다." />
          <div className="auth-done">
            <InfoTable
              label="로그인 정보"
              rows={[
                ["프로젝트 코드", session.projectCode],
                ["닉네임", session.nickname],
                ["비밀번호", "••••••••"],
              ]}
            />
            <Button className="auth-btn auth-btn-primary" onClick={() => onEnter(session)} autoFocus>
              시작하기
            </Button>
          </div>
        </>
      )}
    </AuthFlowLayout>
  );
};
