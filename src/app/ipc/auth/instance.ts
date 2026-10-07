import { app, safeStorage } from "electron";
import path from "node:path";
import { AuthService, readAuthEnv } from "./service";
import { createFileStorage } from "./storage";
import type { AuthSession } from "./types";

// 앱 전체에서 하나만 쓰는 AuthService와 세션 구독. app ready 뒤에 부른다.

const listeners = new Set<(session: AuthSession | null) => void>();
let service: AuthService | null | undefined;

/** Linux에서 키링이 없으면 safeStorage가 고정 키(basic_text)를 쓰므로 암호화가 없는 것으로 본다. */
const cipher = {
  isEncryptionAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encryptString: (plain: string) => safeStorage.encryptString(plain),
  decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
};

/** Supabase 설정이 없으면 null. */
export const getAuthService = (): AuthService | null => {
  if (service !== undefined) return service;
  const env = readAuthEnv();
  const dataDir = app.getPath("userData");
  service = env
    ? new AuthService({
        env,
        dataDir,
        storage: createFileStorage(path.join(dataDir, "auth-session.json"), cipher),
        onSessionChanged: session => {
          for (const listener of listeners) listener(session);
        },
      })
    : null;
  return service;
};

export const addSessionListener = (listener: (session: AuthSession | null) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
