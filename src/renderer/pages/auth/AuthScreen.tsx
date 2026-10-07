import { useEffect, useState } from "react";
import type { AuthBridge, AuthSession } from "../../shared/model/electron-api/auth";
import { CreateFlow } from "./CreateFlow";
import { JoinFlow } from "./JoinFlow";
import { LoginPage } from "./LoginPage";
import type { AuthMode } from "./model";

type Props = {
  bridge: AuthBridge;
  initialMode?: AuthMode;
  /** 로그인·가입·생성 흐름을 마치면 그 세션으로 앱에 들어간다. */
  onEnter: (session: AuthSession) => void;
  /** 있으면 로그인된 앱 위에 띄운 창이다(설정 → 초대코드로 가입). 뒤로 가기는 앱으로 돌아간다. */
  onExit?: () => void;
};

export const AuthScreen = ({ bridge, initialMode = "login", onEnter, onExit }: Props) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const overlay = Boolean(onExit);
  const back = onExit ?? (() => setMode("login"));
  const backLabel = overlay ? "설정" : "로그인";

  useEffect(() => {
    if (!onExit) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const Root = overlay ? "div" : "main";
  return (
    <Root
      className={`auth-screen${overlay ? " overlay" : ""}`}
      data-ck-scroll="light"
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay || undefined}
      aria-label={overlay ? "초대코드로 가입" : undefined}
    >
      {mode === "login" && (
        <LoginPage bridge={bridge} onEnter={onEnter} onJoin={() => setMode("join")} onCreate={() => setMode("create")} />
      )}
      {mode === "join" && <JoinFlow bridge={bridge} backLabel={backLabel} onBack={back} onEnter={onEnter} />}
      {mode === "create" && <CreateFlow bridge={bridge} backLabel={backLabel} onBack={back} onEnter={onEnter} />}
    </Root>
  );
};
