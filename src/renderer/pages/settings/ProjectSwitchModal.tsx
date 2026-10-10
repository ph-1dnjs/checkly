import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { RecentProject } from "../../shared/model/electron-api/auth";
import { errorMessage, formatDate, type AuthAccount } from "../auth/model";
import { SettingsDialog } from "./SettingsDialog";

type Props = { account: AuthAccount; onClose: () => void };

/** 이 기기에서 로그인했던 프로젝트 중 하나를 골라 그 계정으로 다시 로그인한다. */
export const ProjectSwitchModal = ({ account, onClose }: Props) => {
  const { session } = account;
  const [projects, setProjects] = useState<RecentProject[] | null>(null);
  const [pick, setPick] = useState(session.projectCode);
  const [nickname, setNickname] = useState(session.nickname);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const current: RecentProject = { projectCode: session.projectCode, nickname: session.nickname, lastUsedAt: "" };
    account.bridge.listRecentProjects().then(
      (recent) => {
        if (!alive) return;
        // 지금 프로젝트는 목록에 없더라도 맨 위에 보여준다.
        const others = recent.filter((project) => project.projectCode !== session.projectCode);
        const list = [recent.find((project) => project.projectCode === session.projectCode) ?? current, ...others];
        setProjects(list);
        // 디자인처럼 다른 프로젝트가 있으면 그것을 먼저 고른다.
        if (others[0]) choose(others[0]);
      },
      (reason) => {
        if (!alive) return;
        setProjects([current]);
        setError(errorMessage(reason, "최근 프로젝트 목록을 불러오지 못했습니다."));
      },
    );
    return () => {
      alive = false;
    };
    // 창을 열 때 한 번만 읽는다.
  }, []);

  const choose = (project: RecentProject) => {
    setPick(project.projectCode);
    setNickname(project.projectCode === session.projectCode ? session.nickname : project.nickname);
    setPassword("");
    setError("");
  };

  const needsPassword = pick !== session.projectCode;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!needsPassword) return onClose();
    const nick = nickname.trim();
    if (!nick || !password) return setError("닉네임과 비밀번호를 입력하세요.");
    setBusy(true);
    setError("");
    try {
      await account.switchProject({ projectCode: pick, nickname: nick, password });
    } catch (reason) {
      setError(errorMessage(reason, "프로젝트를 바꾸지 못했습니다."));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      eyebrow="PROJECT"
      title="프로젝트 변경"
      description="전환할 프로젝트를 고르고 그 프로젝트의 닉네임과 비밀번호를 입력하세요."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button
            className="settings-dialog-link"
            onClick={() => {
              onClose();
              account.openJoin();
            }}
          >
            <span className="msi" aria-hidden="true">group_add</span>
            초대코드로 가입
          </Button>
          <Button variant="default" className="settings-dialog-push" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !projects} aria-busy={busy}>
            {busy ? "전환 중…" : "전환"}
          </Button>
        </>
      }
    >
      <div className="switch-list" role="radiogroup" aria-label="프로젝트">
        {(projects ?? []).map((project) => {
          const isCurrent = project.projectCode === session.projectCode;
          const on = project.projectCode === pick;
          return (
            <div
              key={project.projectCode}
              className={`switch-item${on ? " on" : ""}`}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(project)}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  choose(project);
                }
              }}
            >
              <span className="switch-radio" aria-hidden="true">
                <i />
              </span>
              <div className="switch-item-body">
                <div className="switch-item-name">{project.projectCode}</div>
                <div className="switch-item-meta">
                  {isCurrent ? `${session.nickname} · 지금 사용 중` : `${project.nickname} · 마지막 접속 ${formatDate(project.lastUsedAt)}`}
                </div>
              </div>
              {isCurrent && <span className="switch-current">현재</span>}
            </div>
          );
        })}
        {!projects && <div className="switch-loading">불러오는 중…</div>}
      </div>
      {needsPassword ? (
        <div className="settings-dialog-body">
          <label className="settings-dialog-field">
            <span>닉네임</span>
            <input
              className="settings-input"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setError("");
              }}
              placeholder="닉네임"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="settings-dialog-field">
            <span>
              비밀번호 · <code>{pick}</code>
            </span>
            <input
              className="settings-input"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder="••••••••"
              autoFocus
            />
          </label>
          {error && (
            <div className="settings-error" role="alert">
              <span className="msi" aria-hidden="true">error</span>
              {error}
            </div>
          )}
          <p className="settings-dialog-note">실행 중인 시나리오는 중단되고, 저장하지 않은 편집 내용은 사라집니다.</p>
        </div>
      ) : (
        error && (
          <div className="settings-dialog-body">
            <div className="settings-error" role="alert">
              <span className="msi" aria-hidden="true">error</span>
              {error}
            </div>
          </div>
        )
      )}
    </SettingsDialog>
  );
};
