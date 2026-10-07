import { BrowserWindow, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import { AuthFailure, MESSAGES, toUserMessage, type AuthResult } from "./errors";
import { onSessionChanged } from "./client";
import { getAuthService } from "./instance";
import type { AuthService } from "./service";
import type { AuthConfig } from "./types";

// 채널 이름은 `auth:<AuthBridge 메서드>`. 결과는 AuthResult로 보내고 bridge.ts가 풀어 준다.
const METHODS = [
  "getSession",
  "signIn",
  "signOut",
  "getRemembered",
  "listRecentProjects",
  "previewInvite",
  "isProjectCodeAvailable",
  "isNicknameAvailable",
  "createProject",
  "joinProject",
  "getProject",
  "regenerateInviteCode",
  "removeMember",
  "changeNickname",
  "changePassword",
  "getProjectSettings",
  "saveProjectSettings",
] as const satisfies readonly (keyof AuthService)[];

const handle = (channel: string, run: (...args: unknown[]) => unknown): void => {
  ipcMain.handle(channel, async (_event, ...args): Promise<AuthResult<unknown>> => {
    try {
      return { ok: true, value: await run(...args) };
    } catch (error) {
      return { ok: false, message: toUserMessage(error) };
    }
  });
};

const requireService = (): AuthService => {
  const service = getAuthService();
  if (!service) throw new AuthFailure(MESSAGES.disabled);
  return service;
};

export const authDomain: MainDomain = {
  register: () => {
    handle("auth:getConfig", (): AuthConfig => ({ enabled: getAuthService() !== null }));
    for (const method of METHODS) {
      handle(`auth:${method}`, (...args) => {
        const service = requireService();
        return (service[method] as (...args: unknown[]) => unknown).apply(service, args);
      });
    }
    onSessionChanged(session => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) window.webContents.send("auth:session", session);
      }
    });
    // 첫 화면이 묻기 전에 저장된 세션 복원을 시작한다. 실패는 getSession 호출 때 다시 알린다.
    getAuthService()?.getSession().catch(() => undefined);
  },
};
