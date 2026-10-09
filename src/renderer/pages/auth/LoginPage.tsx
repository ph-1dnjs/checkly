import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { AuthBridge, AuthSession } from "../../shared/model/electron-api/auth";
import checklyMark from "../../assets/checkly-mark.png";
import { AuthError, AuthInput, PasswordInput, Wordmark } from "./AuthFields";
import { errorMessage } from "./model";

type Props = {
  bridge: AuthBridge;
  onEnter: (session: AuthSession) => void;
  onJoin: () => void;
  onCreate: () => void;
};

export const LoginPage = ({ bridge, onEnter, onJoin, onCreate }: Props) => {
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  // 관리자가 내보내 로그아웃된 경우처럼 직접 하지 않은 로그아웃의 이유.
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    bridge.getSignOutNotice().then(
      (text) => alive && setNotice(text),
      () => undefined,
    );
    bridge.getRemembered().then(
      (remembered) => {
        if (!alive || !remembered) return;
        // 사용자가 먼저 입력을 시작했으면 덮어쓰지 않는다.
        setCode((value) => value || remembered.projectCode);
        setNickname((value) => value || remembered.nickname);
        setRemember(true);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [bridge]);

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError("");
    setNotice("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const projectCode = code.trim();
    const nick = nickname.trim();
    if (!projectCode || !nick || !password) return setError("프로젝트 코드, 닉네임, 비밀번호를 모두 입력하세요.");
    setBusy(true);
    try {
      const session = await bridge.signIn({ projectCode, nickname: nick, password, remember });
      onEnter(session);
    } catch (reason) {
      setError(errorMessage(reason, "로그인하지 못했습니다."));
      setBusy(false);
    }
  };

  return (
    <section className="auth-login" data-screen-label="시작 · 로그인">
      <div className="auth-login-inner">
        <div className="auth-login-brand">
          <img src={checklyMark} alt="Checkly 마크" />
          <h1>
            <Wordmark />
          </h1>
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          <AuthInput
            className="mono"
            value={code}
            onValue={edit((value) => setCode(value.toLowerCase()))}
            placeholder="프로젝트 코드"
            aria-label="프로젝트 코드"
            autoFocus={!code}
          />
          <AuthInput className="mono" value={nickname} onValue={edit(setNickname)} placeholder="닉네임" aria-label="닉네임" autoComplete="username" />
          <PasswordInput
            className="mono"
            value={password}
            onValue={edit(setPassword)}
            placeholder="비밀번호"
            aria-label="비밀번호"
            visible={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
          />
          <label className="auth-remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            기억하기
          </label>
          <AuthError message={error || notice} />
          <Button type="submit" className="auth-btn auth-btn-primary auth-login-submit" disabled={busy} aria-busy={busy}>
            {busy ? "로그인 중…" : "로그인"}
          </Button>
        </form>
        <div className="auth-divider">
          <i />
          처음이신가요?
          <i />
        </div>
        <div className="auth-login-alt">
          <Button className="auth-btn auth-btn-secondary strong" onClick={onJoin}>
            초대코드로 가입
          </Button>
          <div className="auth-login-create">
            팀 프로젝트가 아직 없다면
            <Button className="auth-link" onClick={onCreate}>
              새 프로젝트 만들기
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
