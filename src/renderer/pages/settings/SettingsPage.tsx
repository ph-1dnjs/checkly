import { useState } from "react";
import type { Scenario } from "../../shared/model/scenario";

type Props = { scenario: Scenario };

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

  return (
    <div className="settings-page">
      <h1>설정</h1>

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
