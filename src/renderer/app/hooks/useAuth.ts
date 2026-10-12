import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthBridge, AuthConfig, AuthSession } from "../../shared/model/electron-api/auth";
import { errorMessage, type AuthAccount } from "../../pages/auth/model";

/**
 * - off: 팀 프로젝트 기능이 꺼져 있거나 bridge가 없음(웹 개발 모드·테스트). 지금처럼 로그인 없이 동작한다.
 * - checking: 시작 시 설정·세션 확인 중. 앱을 그리지 않는다.
 * - unavailable: 세션을 확인하지 못함(오프라인 등). 이유와 "다시 시도"만 보인다.
 * - signed-out: 로그인 화면만 보인다.
 * - signed-in: 앱을 보인다.
 */
export type AuthStatus = "off" | "checking" | "unavailable" | "signed-out" | "signed-in";

export type UseAuthResult = {
  status: AuthStatus;
  bridge: AuthBridge | null;
  account: AuthAccount | null;
  /** unavailable일 때 보여줄 main의 문장. */
  error: string;
  /** "다시 시도"를 눌러 확인하는 중. 화면은 unavailable 그대로 둔다. */
  retrying: boolean;
  retry: () => void;
  /** 설정에서 연 초대코드 가입 화면이 앱 위에 떠 있는지. */
  joining: boolean;
  enter: (session: AuthSession) => void;
  closeJoin: () => void;
};

const readBridge = (): AuthBridge | null =>
  (typeof window !== "undefined" && window.electronAPI?.auth) || null;

export const useAuth = (): UseAuthResult => {
  const [bridge] = useState(readBridge);
  const [status, setStatus] = useState<AuthStatus>(bridge ? "checking" : "off");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // 앱이 지금 보여주는 세션과 main이 마지막으로 알린 세션. 다르면 다른 프로젝트로 바뀐 것이다.
  const shownRef = useRef<AuthSession | null>(null);
  const latestRef = useRef<AuthSession | null>(null);
  const enabledRef = useRef(false);
  const joiningRef = useRef(false);
  const reloadingRef = useRef(false);

  const reload = () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    // 프로젝트가 바뀌면 각 기능의 상태를 처음부터 다시 불러오는 게 가장 단순하다.
    window.location.reload();
  };

  const show = (next: AuthSession | null) => {
    shownRef.current = next;
    setSession(next);
    setStatus(next ? "signed-in" : "signed-out");
  };

  const setJoin = (open: boolean) => {
    joiningRef.current = open;
    setJoining(open);
  };

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.onSessionChange((next) => {
      latestRef.current = next;
      if (!alive || !enabledRef.current || reloadingRef.current) return;
      const shown = shownRef.current;
      if (!next) {
        // 로그아웃·만료: 로그인 화면으로.
        setJoin(false);
        show(null);
        return;
      }
      // 로그인 화면에서는 각 흐름이 끝날 때(enter) 들어간다. 가입 완료 화면을 건너뛰지 않도록 여기서는 기다린다.
      if (!shown) return;
      if (next.projectId !== shown.projectId) {
        if (!joiningRef.current) reload();
        return;
      }
      shownRef.current = next;
      setSession(next);
    });

    void (async () => {
      let config: AuthConfig;
      try {
        config = await bridge.getConfig();
      } catch (reason) {
        // 설정을 읽지 못하면 로그인 없는 기존 모드로 둔다.
        console.error(reason);
        if (!alive) return;
        setRetrying(false);
        setStatus("off");
        return;
      }
      if (!alive) return;
      if (!config.enabled) return setStatus("off");
      enabledRef.current = true;
      try {
        const current = await bridge.getSession();
        if (!alive) return;
        latestRef.current = current;
        setError("");
        show(current);
      } catch (reason) {
        // 서버에 닿지 못하면 로그인 화면 대신 이유와 다시 시도를 보여준다.
        if (!alive) return;
        setError(errorMessage(reason, "로그인 상태를 확인하지 못했습니다."));
        setStatus("unavailable");
      } finally {
        if (alive) setRetrying(false);
      }
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [bridge, attempt]);

  const retry = useCallback(() => {
    setRetrying(true);
    setAttempt((value) => value + 1);
  }, []);

  const enter = useCallback((next: AuthSession) => {
    latestRef.current = next;
    const shown = shownRef.current;
    // 설정에서 다른 프로젝트에 가입했다면 그 프로젝트로 다시 시작한다.
    if (shown && shown.projectId !== next.projectId) return reload();
    setJoin(false);
    show(next);
  }, []);

  const closeJoin = useCallback(() => {
    const shown = shownRef.current;
    const latest = latestRef.current;
    if (shown && latest && latest.projectId !== shown.projectId) return reload();
    setJoin(false);
  }, []);

  const account = useMemo<AuthAccount | null>(() => {
    if (!bridge || status !== "signed-in" || !session) return null;
    return {
      bridge,
      session,
      signOut: async () => {
        await bridge.signOut();
        setJoin(false);
        show(null);
      },
      switchProject: async ({ projectCode, nickname, password }) => {
        const remembered = await bridge.getRemembered().catch(() => null);
        joiningRef.current = true; // 이벤트로 먼저 reload되지 않게 하고 아래에서 한 번만 다시 불러온다.
        try {
          const next = await bridge.signIn({ projectCode, nickname, password, remember: remembered !== null });
          latestRef.current = next;
          reload();
        } finally {
          joiningRef.current = joining;
        }
      },
      openJoin: () => setJoin(true),
      updateSession: (next) => {
        latestRef.current = next;
        shownRef.current = next;
        setSession(next);
      },
    };
  }, [bridge, status, session, joining]);

  return { status, bridge, account, error, retrying, retry, joining, enter, closeJoin };
};
