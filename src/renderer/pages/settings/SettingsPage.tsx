import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { WindowSettingsSection } from "./WindowSettingsSection";
import type { Scenario } from "../../shared/model/scenario";
import type { UpdateStatus } from "../../shared/model/update";
import checklyMark from "../../assets/checkly-mark.png";
import { copyText, type AuthAccount } from "../auth/model";
import { AccountCard } from "./AccountCard";
import { AccountSection } from "./AccountSection";
import { EndpointSettings } from "./EndpointSettings";
import { SettingRow, SettingsSection, Switch, useOpenSections, type SectionId } from "./SettingsSection";
import { TeamProjectSettings } from "./TeamProjectSettings";
import { useProjectInfo } from "./useProjectInfo";

// account는 팀 프로젝트가 켜져 있고 로그인했을 때만 있다. 없으면 팀 섹션 대신 예전 프로젝트 행을 보여준다.
type Props = { scenario: Scenario; account?: AuthAccount | null };

const RELEASES_URL = "https://github.com/ph-1dnjs/checkly/releases/latest";
const UNQUARANTINE = "xattr -cr /Applications/Checkly.app";
const isMac = navigator.userAgent.includes("Mac");

const TEAM_SECTIONS: SectionId[] = ["account", "team", "endpoints", "run", "app"];
const LOCAL_SECTIONS: SectionId[] = ["project", "run", "app"];

const updateStatusLabel = (status: UpdateStatus): string => {
  switch (status.state) {
    case "checking":
      return "확인 중";
    case "available":
      return `새 버전 ${status.version} 내려받는 중`;
    case "downloading":
      return `내려받는 중 (${status.percent}%)`;
    case "downloaded":
      return `새 버전 ${status.version} 설치 준비 완료`;
    case "error":
      return `업데이트 확인 실패: ${status.message}`;
    default:
      return "최신 버전";
  }
};

const updateTone = (status: UpdateStatus): { icon: string; tone: string } => {
  switch (status.state) {
    case "checking":
    case "available":
    case "downloading":
      return { icon: "progress_activity", tone: "busy" };
    case "downloaded":
      return { icon: "download_done", tone: "info" };
    case "error":
      return { icon: "error", tone: "fail" };
    default:
      return { icon: "check_circle", tone: "pass" };
  }
};

export const SettingsPage = ({ scenario, account }: Props) => {
  const project = useProjectInfo(account);
  const sections = useOpenSections(account ? TEAM_SECTIONS : LOCAL_SECTIONS);
  const [keepVideo, setKeepVideo] = useState(true);
  const [notifyFail, setNotifyFail] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [autoCheck, setAutoCheck] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
  });
  const [macHelp, setMacHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion);
    void window.electronAPI.getUpdateSettings().then((settings) =>
      setAutoCheck(settings.autoCheck),
    );
    void window.electronAPI.getUpdateStatus().then(setUpdateStatus);
    const unsubscribe = window.electronAPI.onUpdateStatus(setUpdateStatus);
    return () => {
      unsubscribe();
      window.clearTimeout(copiedTimer.current);
    };
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

  const copyCommand = async () => {
    if (!(await copyText(UNQUARANTINE))) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  const section = (id: SectionId, icon: string, title: string) => ({
    icon,
    title,
    open: sections.isOpen(id),
    onToggle: () => sections.toggle(id),
  });
  const version = appVersion ? `v${appVersion}` : "—";
  const update = updateTone(updateStatus);
  const updating = updateStatus.state === "checking" || updateStatus.state === "downloading";

  return (
    <div className="settings-scroll">
      <div className="settings-shell" data-screen-label="설정">
        <h1 className="settings-title">설정</h1>

        {account && <AccountCard account={account} project={project} />}

        <div className="settings-toolbar">
          <Button
            variant="ghost"
            iconOnly
            className="settings-fold-all"
            aria-label={sections.allOpen ? "모두 접기" : "모두 펼치기"}
            title={sections.allOpen ? "모두 접기" : "모두 펼치기"}
            onClick={sections.toggleAll}
          >
            <span className="msi" aria-hidden="true">{sections.allOpen ? "unfold_less" : "unfold_more"}</span>
          </Button>
        </div>

        {account ? (
          <>
            <SettingsSection {...section("account", "person", "내 계정")}>
              <AccountSection account={account} />
            </SettingsSection>
            <SettingsSection {...section("team", "group", "팀 프로젝트")}>
              <TeamProjectSettings account={account} project={project} />
            </SettingsSection>
            <SettingsSection {...section("endpoints", "dns", "엔드포인트")}>
              <EndpointSettings account={account} />
            </SettingsSection>
          </>
        ) : (
          <SettingsSection {...section("project", "folder", "프로젝트")}>
            <SettingRow label="기본 URL">
              <span className="setting-mono">{scenario.url || "—"}</span>
            </SettingRow>
            <SettingRow label="환경">
              <span className="setting-mono">dev</span>
            </SettingRow>
          </SettingsSection>
        )}

        <SettingsSection {...section("run", "play_circle", "실행·알림")}>
          <SettingRow label="기본 브라우저" action={<span className="setting-muted small">다른 브라우저 준비 중</span>}>
            <span className="setting-mono">Chromium</span>
          </SettingRow>
          <SettingRow
            label="실행 영상 보관"
            action={<Switch label="실행 영상 보관" on={keepVideo} onToggle={() => setKeepVideo((value) => !value)} />}
          >
            <span className="setting-hint">실패한 실행은 30일간 보관</span>
          </SettingRow>
          <SettingRow
            label="실패 시 알림"
            action={<Switch label="실패 시 알림" on={notifyFail} onToggle={() => setNotifyFail((value) => !value)} />}
          />
          <SettingRow label="Slack 연동" disabled action={<Switch label="Slack 연동" on={false} disabled onToggle={() => undefined} />}>
            <span className="setting-hint">준비 중</span>
          </SettingRow>
        </SettingsSection>

        <SettingsSection {...section("app", "computer", "앱")}>
          <SettingRow
            label="현재 버전"
            action={
              updateStatus.state === "downloaded" ? (
                <Button variant="primary" className="setting-chip" onClick={() => void window.electronAPI.installUpdate()}>
                  재시작하여 설치
                </Button>
              ) : (
                <Button variant="secondary" className="setting-chip" disabled={updating} onClick={checkNow}>
                  {updateStatus.state === "checking" ? "확인 중…" : "업데이트 확인"}
                </Button>
              )
            }
          >
            <span className="setting-version">
              <span className="setting-mono">{version}</span>
              <span className="setting-update" data-tone={update.tone} aria-live="polite">
                <span className="msi" aria-hidden="true">{update.icon}</span>
                {updateStatusLabel(updateStatus)}
              </span>
            </span>
          </SettingRow>
          <SettingRow label="자동 업데이트 확인" action={<Switch label="자동 업데이트 확인" on={autoCheck} onToggle={toggleAutoCheck} />} />
          <WindowSettingsSection />
          <SettingRow
            label="설치 파일"
            action={
              <a className="setting-chip" href={RELEASES_URL} target="_blank" rel="noreferrer">
                GitHub Releases
                <span className="msi muted" aria-hidden="true">open_in_new</span>
              </a>
            }
          >
            {isMac && (
              <Button className="setting-disclosure" aria-expanded={macHelp} onClick={() => setMacHelp((value) => !value)}>
                <span className="msi" aria-hidden="true">{macHelp ? "expand_more" : "chevron_right"}</span>
                macOS "손상됨" 오류가 뜰 때
              </Button>
            )}
          </SettingRow>
          {isMac && macHelp && (
            <div className="setting-row-note setting-command-help">
              <span>터미널에서 실행한 뒤 다시 여세요</span>
              <div className="setting-command">
                <code>{UNQUARANTINE}</code>
                <Button variant="ghost" onClick={() => void copyCommand()} aria-label={copied ? "명령어 복사됨" : "명령어 복사"}>
                  <span className="msi" aria-hidden="true">{copied ? "check" : "content_copy"}</span>
                  {copied ? "복사됨" : "복사"}
                </Button>
              </div>
            </div>
          )}
        </SettingsSection>

        <div className="settings-brand-footer">
          <img src={checklyMark} alt="Checkly 마크" />
          <div className="settings-brand-wordmark">
            Check<span>ly</span>
          </div>
          <div className="settings-brand-tagline">반복되는 확인을 대신 맡습니다</div>
          <div className="settings-brand-version">{version}</div>
        </div>
      </div>
    </div>
  );
};
