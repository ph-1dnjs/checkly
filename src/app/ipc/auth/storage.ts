import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupportedStorage } from "@supabase/supabase-js";

/** Electron safeStorage와 같은 모양. 테스트에서는 가짜를 넣는다. */
export type SessionCipher = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

/**
 * supabase-js 세션 저장소. 값 전체를 암호화해 파일 하나에 둔다.
 * 암호화를 쓸 수 없으면 토큰을 평문으로 남기지 않도록 메모리에만 둔다(앱을 다시 켜면 로그인).
 */
export const createFileStorage = (file: string, cipher: SessionCipher): SupportedStorage => {
  let items: Promise<Record<string, string>> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const load = (): Promise<Record<string, string>> =>
    (items ??= (async () => {
      if (!cipher.isEncryptionAvailable()) return {};
      try {
        return JSON.parse(cipher.decryptString(await readFile(file))) as Record<string, string>;
      } catch {
        return {};
      }
    })());

  const save = async (): Promise<void> => {
    const data = await load();
    if (!cipher.isEncryptionAvailable()) return;
    // 마지막 상태가 남도록 쓰기를 차례로 처리한다.
    writing = writing
      .then(async () => {
        if (Object.keys(data).length === 0) return rm(file, { force: true });
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cipher.encryptString(JSON.stringify(data)));
      })
      .catch(error => console.error("[auth] 세션 저장 실패", error));
    await writing;
  };

  return {
    getItem: async key => (await load())[key] ?? null,
    setItem: async (key, value) => {
      (await load())[key] = value;
      await save();
    },
    removeItem: async key => {
      delete (await load())[key];
      await save();
    },
  };
};
