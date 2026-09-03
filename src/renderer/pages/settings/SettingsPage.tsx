import { useEffect, useState } from "react";
import type { Scenario } from "../../shared/model/scenario";
import type { UpdateStatus } from "../../shared/model/update";

type Props = { scenario: Scenario };

const RELEASES_URL = "https://github.com/ph-1dnjs/checkly/releases/latest";

const updateStatusLabel = (status: UpdateStatus): string => {
  switch (status.state) {
    case "checking":
      return "새 버전을 확인하는 중입니다";
    case "available":
      return `새 버전 ${status.version}을(를) 내려받는 중입니다`;
    case "not-available":
      return "최신 버전을 사용 중입니다";
    case "downloading":
      return `새 버전을 내려받는 중입니다 (${status.percent}%)`;
    case "downloaded":
      return `새 버전 ${status.version} 설치 준비가 끝났습니다`;
    case "error":
      return `업데이트 확인에 실패했습니다: ${status.message}`;
    default:
      return "";
  }
};

const Toggle = ({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
}) => (
  <div className="settings-row">
    <div>
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-hint">{hint}</div>
    </div>
    <button
      className={`settings-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <i />
    </button>
  </div>
);

export const SettingsPage = ({ scenario }: Props) => {
  const [keepVideo, setKeepVideo] = useState(true);
  const [notifyFail, setNotifyFail] = useState(true);
  const [notifySlack, setNotifySlack] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [autoCheck, setAutoCheck] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
  });

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion);
    void window.electronAPI.getUpdateSettings().then((settings) =>
      setAutoCheck(settings.autoCheck),
    );
    void window.electronAPI.getUpdateStatus().then(setUpdateStatus);
    return window.electronAPI.onUpdateStatus(setUpdateStatus);
  }, []);

  const toggleAutoCheck = () => {
    setAutoCheck((value) => {
      const next = !value;
      void window.electronAPI.setUpdateAutoCheck(next);
      return next;
    });
  };

  const checkNow = () => {
    setUpdateStatus({ state: "checking" });
    void window.electronAPI.checkForUpdates().then(setUpdateStatus);
  };

  return (
    <div className="settings-page">
      <h1>설정</h1>

      <div className="settings-group">
        <div className="settings-group-label">
          <span>UPDATE</span>
          <i />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">현재 버전</div>
            <div className="settings-row-hint">
              {updateStatus.state === "idle" || updateStatus.state === "not-available"
                ? "최신 버전입니다"
                : updateStatusLabel(updateStatus)}
            </div>
          </div>
          <div className="settings-row-value">
            v{appVersion || "—"}
            {updateStatus.state === "downloaded" ? (
              <button
                className="button button-primary"
                onClick={() => void window.electronAPI.installUpdate()}
              >
                재시작하여 설치
              </button>
            ) : (
              <button
                className="button"
                disabled={updateStatus.state === "checking" || updateStatus.state === "downloading"}
                onClick={checkNow}
              >
                {updateStatus.state === "checking" ? "확인 중…" : "지금 확인"}
              </button>
            )}
          </div>
        </div>
        <Toggle
          label="자동 업데이트 확인"
          hint="앱을 실행하는 동안 주기적으로 새 버전을 확인합니다"
          on={autoCheck}
          onToggle={toggleAutoCheck}
        />
        <div className="settings-row">
          <div>
            <div className="settings-row-label">다운로드</div>
            <div className="settings-row-hint">최신 설치 파일을 GitHub Releases에서 내려받습니다</div>
          </div>
          <div className="settings-row-value">
            <a
              className="button"
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
            >
              다운로드 페이지 열기
            </a>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-label">
          <span>PROJECT</span>
          <i />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">기본 URL</div>
            <div className="settings-row-hint">실행 시 상대 경로의 기준</div>
          </div>
          <div className="settings-row-value">{scenario.url || "—"}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">환경</div>
            <div className="settings-row-hint">dev / staging / prod</div>
          </div>
          <div className="settings-row-value">dev</div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-label">
          <span>RUN DEFAULTS</span>
          <i />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">기본 브라우저</div>
            <div className="settings-row-hint">새 실행에 적용됩니다</div>
          </div>
          <div className="settings-row-value">
            Chromium
            <button className="button">변경</button>
          </div>
        </div>
        <Toggle
          label="실행 영상 보관"
          hint="실패한 실행은 30일간 보관"
          on={keepVideo}
          onToggle={() => setKeepVideo((value) => !value)}
        />
      </div>

      <div className="settings-group">
        <div className="settings-group-label">
          <span>NOTIFICATIONS</span>
          <i />
        </div>
        <Toggle
          label="실패 시 알림"
          hint="실행 종료 후 즉시 전송"
          on={notifyFail}
          onToggle={() => setNotifyFail((value) => !value)}
        />
        <Toggle
          label="Slack 연동"
          hint="#qa-alerts 채널"
          on={notifySlack}
          onToggle={() => setNotifySlack((value) => !value)}
        />
      </div>
    </div>
  );
};
