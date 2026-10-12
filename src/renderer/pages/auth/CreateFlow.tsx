import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { AuthBridge, AuthSession } from "../../shared/model/electron-api/auth";
import { AuthFlowLayout, FlowHeading } from "./AuthFlowLayout";
import { AuthError, AuthInput, CopyButton, Field, InfoTable, PasswordInput } from "./AuthFields";
import {
  errorMessage,
  fieldCheck,
  NICKNAME_HINT,
  NICKNAME_PATTERN,
  passwordError,
  PASSWORD_MIN,
  PROJECT_CODE_HINT,
  PROJECT_CODE_PATTERN,
  roleLabel,
} from "./model";
import { useAvailability } from "./useAvailability";

type Props = {
  bridge: AuthBridge;
  backLabel: string;
  onBack: () => void;
  onEnter: (session: AuthSession) => void;
};

const STEPS = ["프로젝트 설정", "초대코드 공유"];

export const CreateFlow = ({ bridge, backLabel, onBack, onEnter }: Props) => {
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [created, setCreated] = useState<{ session: AuthSession; inviteCode: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const projectCode = code.trim();
  const nick = nickname.trim();
  const codeAvailability = useAvailability(!created && PROJECT_CODE_PATTERN.test(projectCode) ? projectCode : null, (value) =>
    bridge.isProjectCodeAvailable(value),
  );
  const codeCheck = fieldCheck(projectCode, PROJECT_CODE_PATTERN, PROJECT_CODE_HINT, codeAvailability, {
    taken: "이미 사용 중인 프로젝트 코드입니다",
    available: "사용할 수 있는 코드입니다",
  });
  // 새 프로젝트에는 아직 멤버가 없으므로 형식만 본다.
  const nickCheck = fieldCheck(nick, NICKNAME_PATTERN, NICKNAME_HINT, null, { taken: "", available: "" });

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!codeCheck.ok) return setError(projectCode ? `${codeCheck.text}.` : "프로젝트 코드를 입력하세요.");
    if (!nickCheck.ok) return setError(nick ? `${nickCheck.text}.` : "닉네임을 입력하세요.");
    const passwordProblem = passwordError(password, confirm);
    if (passwordProblem) return setError(passwordProblem);
    const operatorCode = createCode.trim();
    if (!operatorCode) return setError("생성 코드를 입력하세요. 운영자에게 받은 코드입니다.");
    setBusy(true);
    try {
      setCreated(await bridge.createProject({ code: projectCode, nickname: nick, password, createCode: operatorCode }));
      setError("");
    } catch (reason) {
      setError(errorMessage(reason, "프로젝트를 만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFlowLayout
      screenLabel="시작 · 새 프로젝트"
      steps={STEPS}
      current={created ? 2 : 1}
      backLabel={created ? null : backLabel}
      onBack={onBack}
    >
      {!created ? (
        <>
          <FlowHeading
            title="새 프로젝트 만들기"
            description="프로젝트 코드는 팀원이 로그인할 때 입력합니다. 만든 사람이 관리자가 됩니다."
          />
          <form className="auth-form" onSubmit={submit} noValidate>
            <Field label="프로젝트 코드" check={codeCheck}>
              <AuthInput
                className="mono"
                value={code}
                onValue={edit((value) => setCode(value.toLowerCase()))}
                placeholder="checkly-team"
                aria-label="프로젝트 코드"
                maxLength={32}
                autoFocus
              />
            </Field>
            <Field label="닉네임" check={nickCheck}>
              <AuthInput className="mono" value={nickname} onValue={edit(setNickname)} placeholder="hyewon" aria-label="닉네임" />
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
            <Field label="생성 코드" className="auth-field-gap" check={{ text: "운영자에게 받은 코드", tone: "hint", ok: true }}>
              <PasswordInput
                className="mono"
                value={createCode}
                onValue={edit(setCreateCode)}
                placeholder="코드 입력"
                aria-label="생성 코드"
                autoComplete="off"
                spellCheck={false}
                subject="생성 코드"
                visible={showCreateCode}
                onToggle={() => setShowCreateCode((value) => !value)}
              />
            </Field>
            <AuthError message={error} />
            <div className="auth-actions">
              <Button className="auth-btn auth-btn-secondary" onClick={onBack}>
                취소
              </Button>
              <Button type="submit" className="auth-btn auth-btn-primary" disabled={busy} aria-busy={busy}>
                {busy ? "만드는 중…" : "프로젝트 만들기"}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <>
          <FlowHeading
            done
            title="프로젝트를 만들었습니다"
            description="팀원에게 초대코드를 공유하세요. 팀원은 초대코드로 가입한 뒤 프로젝트 코드, 닉네임, 비밀번호로 로그인합니다."
          />
          <div className="auth-done">
            <div>
              <div className="auth-field-label">초대코드</div>
              <div className="auth-invite">
                <span className="auth-invite-code">
                  {created.inviteCode}
                </span>
                <CopyButton value={created.inviteCode} subject="초대코드" />
              </div>
              <div className="auth-invite-note">설정 &gt; 프로젝트에서 언제든 다시 볼 수 있습니다.</div>
            </div>
            <InfoTable
              label="만든 프로젝트"
              rows={[
                ["프로젝트 코드", created.session.projectCode],
                ["닉네임", created.session.nickname],
                ["역할", roleLabel(created.session.role)],
              ]}
            />
            <Button className="auth-btn auth-btn-primary" onClick={() => onEnter(created.session)}>
              시작하기
            </Button>
          </div>
        </>
      )}
    </AuthFlowLayout>
  );
};
