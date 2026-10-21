import { useEffect, useState } from "react";
import type { ApiTeamSettings } from "../../../app/api-testing/shared/workspace";
import { errorMessage, formatDate } from "../auth/model";
import { InlineConfirm, SettingRow, Switch } from "./SettingsSection";

export const SHARE_SECRETS_HINT = "API 테스트의 개발용 계정·토큰";

/**
 * 팀 프로젝트 · "비밀값도 팀에 공유" (팀 전체 설정, 기본 켬). API 테스트가 저장하는 값에만 적용되므로
 * API 테스트 bridge로 읽고 쓴다. 끌 때는 이미 팀에 올라간 비밀값을 지운다고 행 아래에서 확인받는다.
 */
export const ShareSecretsRow = ({ projectId }: { projectId: string }) => {
  const bridge = window.electronAPI?.apiTesting;
  const supported = typeof bridge?.getTeamSettings === "function";
  const [settings, setSettings] = useState<ApiTeamSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    bridge.getTeamSettings().then(
      (value) => alive && (setSettings(value), setError("")),
      (reason) => alive && setError(errorMessage(reason, "설정을 불러오지 못했습니다.")),
    );
    return () => {
      alive = false;
    };
  }, [bridge, supported, projectId]);

  if (!supported) return null;
  const on = settings?.shareSecrets ?? true;
  const save = async (next: boolean) => {
    setBusy(true);
    setError("");
    try {
      setSettings(await bridge.setShareSecrets(next));
      setConfirmOff(false);
    } catch (reason) {
      setError(errorMessage(reason, "설정을 바꾸지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  const changed = settings?.updatedBy && settings.updatedAt ? ` · ${settings.updatedBy}님이 ${formatDate(settings.updatedAt)}에 바꿈` : "";

  return (
    <>
      <SettingRow
        label="비밀값도 팀에 공유"
        action={
          <Switch
            on={on}
            label="비밀값도 팀에 공유"
            disabled={busy || !settings}
            onToggle={() => (on ? setConfirmOff(true) : void save(true))}
          />
        }
      >
        <span className="setting-hint" title="운영 계정을 넣는 프로젝트라면 끄세요.">
          {SHARE_SECRETS_HINT}
          {changed}
        </span>
      </SettingRow>
      {confirmOff && (
        <InlineConfirm
          message="끄면 팀에 저장된 비밀값이 지워지고, 각자 이 컴퓨터에서 다시 입력합니다"
          confirmLabel="끄기"
          busy={busy}
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => void save(false)}
        />
      )}
      {error && (
        <div className="setting-row-note">
          <div className="settings-error" role="alert">
            <span className="msi" aria-hidden="true">error</span>
            {error}
          </div>
        </div>
      )}
    </>
  );
};
