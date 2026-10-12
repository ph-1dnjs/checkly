import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthFailure, MESSAGES } from "./errors";
import { addSessionListener, appAuthEnv, getAuthService } from "./instance";
import type { AuthSession } from "./types";

// main의 다른 기능(API 테스트 저장소 등)이 팀 프로젝트 DB를 쓸 때의 진입점. 렌더러는 bridge.ts를 쓴다.

/** Supabase URL·anon 키가 설정됐는지. false면 기존 로컬 모드로 동작한다. */
export const isSupabaseEnabled = (): boolean => appAuthEnv() !== null;

/** 현재 멤버로 로그인된 클라이언트 하나(로그아웃 상태면 anon). 설정이 없으면 던진다. */
export const getSupabase = (): SupabaseClient => {
  const service = getAuthService();
  if (!service) throw new AuthFailure(MESSAGES.disabled);
  return service.client;
};

/** 마지막으로 알려진 세션. 시작 직후 복원이 끝나기 전에는 null일 수 있다(onSessionChanged로 알림). */
export const getCurrentSession = (): AuthSession | null => getAuthService()?.session ?? null;

/** 로그인·로그아웃·만료·닉네임 변경 때 호출한다. 반환값은 구독 해제. */
export const onSessionChanged = (listener: (session: AuthSession | null) => void): (() => void) =>
  addSessionListener(listener);
