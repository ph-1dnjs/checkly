import { dialog, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import { getCurrentSession, getSupabase } from "../auth/client";
import { AuthFailure, MESSAGES, toUserMessage } from "../auth/errors";
import { WebScenarioStore } from "./store";
import type { RunRecord } from "./scenario";
import type { WebScenarioInput } from "./types";

export const webScenarioDomain: MainDomain = {
  register: () => {
    const handle = (name: string, run: (store: WebScenarioStore, ...args: any[]) => Promise<unknown>) => {
      ipcMain.handle(`web-scenario:${name}`, async (_event, ...args) => {
        try {
          const session = getCurrentSession();
          if (!session) throw new AuthFailure(MESSAGES.signedOut);
          const value = await run(new WebScenarioStore(getSupabase(), session.projectId), ...args);
          if (getCurrentSession()?.userId !== session.userId) throw new AuthFailure(MESSAGES.expired);
          return { ok: true, value };
        } catch (error) { return { ok: false, message: toUserMessage(error) }; }
      });
    };
    handle("listRuns", store => store.listRuns());
    handle("saveRun", (store, record: RunRecord) => store.saveRun(record));
    handle("list", store => store.list());
    handle("save", (store, input: WebScenarioInput) => store.save(input));
    handle("remove", (store, id: string, version: string) => store.remove(id, version));
    ipcMain.handle("qa:select-upload-file", async () => {
      const result = await dialog.showOpenDialog({ title: "업로드할 파일 선택", properties: ["openFile"] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
  },
};
