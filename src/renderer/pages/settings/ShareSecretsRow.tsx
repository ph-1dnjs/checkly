import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Button";
import type { ApiTeamSettings } from "../../../app/api-testing/shared/workspace";
import { errorMessage, formatDate } from "../auth/model";
import { ConfirmDialog } from "./SettingsDialog";

export const SHARE_SECRETS_HINT = "개발용 계정·토큰을 팀원과 같이 씁니다. 운영 계정을 넣는 프로젝트라면 끄세요.";

/**
 * PROJECT · "비밀값도 팀에 공유" (팀 전체 설정, 기본 켬). API 테스트가 저장하는 값에만 적용되므로
 * API 테스트 bridge로 읽고 쓴다. 끌 때는 이미 팀에 올라간 비밀값을 지운다고 확인받는다.
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
    } finally {
      setBusy(false);
    }
  };
  const changed = settings?.updatedBy && settings.updatedAt ? ` · ${settings.updatedBy}님이 ${formatDate(settings.updatedAt)}에 바꿈` : "";

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">비밀값도 팀에 공유</div>
        <div className="settings-row-hint">
          {SHARE_SECRETS_HINT}
          {changed}
        </div>
        {error && (
          <div className="settings-error" role="alert">
            <span className="msi" aria-hidden="true">error</span>
            {error}
          </div>
        )}
      </div>
      <Button
        className={`settings-toggle${on ? " on" : ""}`}
        onClick={() => {
          if (busy || !settings) return;
          if (on) setConfirmOff(true);
          else void save(true).catch((reason) => setError(errorMessage(reason, "설정을 바꾸지 못했습니다.")));
        }}
        disabled={busy || !settings}
        role="switch"
        aria-checked={on}
        aria-label="비밀값도 팀에 공유"
      >
        <i />
      </Button>
      {confirmOff && (
        <ConfirmDialog
          eyebrow="SECRETS"
          title="비밀값 공유를 끌까요?"
          description="팀에 저장된 비밀값(API 문서 개별 요청 입력값의 토큰·비밀번호, 스웨거 문서 계정)을 지웁니다. 이후에는 각자 이 컴퓨터에서 다시 입력합니다."
          confirmLabel="끄기"
          danger
          onClose={() => setConfirmOff(false)}
          onConfirm={() => save(false)}
        />
      )}
    </div>
  );
};
