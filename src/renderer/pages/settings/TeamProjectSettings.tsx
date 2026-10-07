import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { ProjectMember } from "../../shared/model/electron-api/auth";
import { CopyButton } from "../auth/AuthFields";
import { errorMessage, formatDate, NICKNAME_HINT, NICKNAME_PATTERN, passwordError, PASSWORD_MIN, type AuthAccount } from "../auth/model";
import { EndpointMatrix } from "./EndpointMatrix";
import { ConfirmDialog } from "./SettingsDialog";
import type { ProjectInfoState } from "./useProjectInfo";

type Props = { account: AuthAccount; project: ProjectInfoState };

/** 로그인했을 때 설정의 PROJECT·PROFILE 그룹. 꺼져 있으면 SettingsPage가 예전 PROJECT 행을 그대로 보여준다. */
export const TeamProjectSettings = ({ account, project }: Props) => (
  <>
    <ProjectGroup account={account} project={project} />
    <ProfileGroup account={account} />
  </>
);

const ProjectGroup = ({ account, project }: Props) => {
  const { session, bridge } = account;
  const isOwner = session.role === "owner";
  const info = project.info;
  const [confirm, setConfirm] = useState<{ kind: "invite" } | { kind: "remove"; member: ProjectMember } | null>(null);

  return (
    <div className="settings-group" aria-label="프로젝트">
      <div className="settings-group-label">
        <span>PROJECT</span>
        <i />
      </div>
      {project.error && !info && (
        <div className="settings-callout" data-tone="fail" role="alert">
          <span>{project.error}</span>
          <Button variant="default" onClick={project.reload}>
            다시 불러오기
          </Button>
        </div>
      )}
      <div className="settings-row wide">
        <div>
          <div className="settings-row-label">초대코드</div>
          <div className="settings-row-hint">
            새 팀원이 처음 가입할 때 입력합니다{isOwner ? " · 재발급하면 이전 코드는 쓸 수 없습니다" : ""}
          </div>
        </div>
        <div className="settings-row-value">
          <span className="settings-invite-code">
            {info?.inviteCode ?? "—"}
          </span>
          <CopyButton className="button" value={info?.inviteCode ?? ""} subject="초대코드" />
          {isOwner && (
            <Button variant="default" disabled={!info} onClick={() => setConfirm({ kind: "invite" })}>
              재발급
            </Button>
          )}
        </div>
      </div>
      <div className="settings-row settings-row-stack">
        <div>
          <div className="settings-row-label">멤버</div>
          <div className="settings-row-hint">{info ? `팀원 ${info.members.length}명` : "불러오는 중…"}</div>
        </div>
        {info && (
          <ul className="member-list" aria-label="멤버 목록">
            {info.members.map((member) => (
              <li key={member.userId} className="member-row">
                <span className="member-avatar" aria-hidden="true">
                  {member.nickname.charAt(0).toUpperCase()}
                </span>
                <span className="member-name">{member.nickname}</span>
                {member.role === "owner" && <span className="member-badge">관리자</span>}
                {member.userId === session.userId && <span className="member-badge self">나</span>}
                <span className="member-meta">가입 {formatDate(member.createdAt)}</span>
                {isOwner && member.role !== "owner" && member.userId !== session.userId && (
                  <Button
                    className="member-remove"
                    onClick={() => setConfirm({ kind: "remove", member })}
                    aria-label={`${member.nickname} 내보내기`}
                  >
                    내보내기
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="settings-row settings-row-stack">
        <div>
          <div className="settings-row-label">엔드포인트 × 환경</div>
          <div className="settings-row-hint">
            웹 시나리오·폼 자동 완성·API 테스트가 같이 쓰는 주소입니다. 각 기능은 자기 화면에서 환경을 고릅니다. 빈 칸은 미설정입니다.
          </div>
        </div>
        <EndpointMatrix account={account} />
      </div>

      {confirm?.kind === "invite" && (
        <ConfirmDialog
          eyebrow="INVITE CODE"
          title="초대코드를 재발급할까요?"
          description="지금 초대코드는 바로 쓸 수 없게 됩니다. 이미 가입한 팀원에게는 영향이 없습니다."
          confirmLabel="재발급"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const inviteCode = await bridge.regenerateInviteCode();
            project.update((current) => ({ ...current, inviteCode }));
          }}
        />
      )}
      {confirm?.kind === "remove" && (
        <ConfirmDialog
          eyebrow="MEMBER"
          title={`${confirm.member.nickname}님을 내보낼까요?`}
          description="이 팀원의 계정이 삭제됩니다. 다시 참여하려면 초대코드로 새로 가입해야 합니다."
          confirmLabel="내보내기"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await bridge.removeMember(confirm.member.userId);
            const removed = confirm.member.userId;
            project.update((current) => ({ ...current, members: current.members.filter((member) => member.userId !== removed) }));
          }}
        />
      )}
    </div>
  );
};

const Feedback = ({ error, done }: { error: string; done: string }) =>
  error ? (
    <div className="settings-error" role="alert">
      <span className="msi" aria-hidden="true">error</span>
      {error}
    </div>
  ) : done ? (
    <div className="settings-done" role="status">
      <span className="msi" aria-hidden="true">check</span>
      {done}
    </div>
  ) : null;

const ProfileGroup = ({ account }: { account: AuthAccount }) => {
  const { session, bridge } = account;
  const [nickname, setNickname] = useState(session.nickname);
  const [nickError, setNickError] = useState("");
  const [nickDone, setNickDone] = useState("");
  const [nickBusy, setNickBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const nick = nickname.trim();

  const changeNickname = async (event: FormEvent) => {
    event.preventDefault();
    if (nickBusy || nick === session.nickname) return;
    setNickDone("");
    if (!NICKNAME_PATTERN.test(nick)) return setNickError(`${NICKNAME_HINT}.`);
    setNickBusy(true);
    setNickError("");
    try {
      const updated = await bridge.changeNickname(nick);
      account.updateSession(updated);
      setNickname(updated.nickname);
      setNickDone("닉네임을 바꿨습니다. 다음 로그인부터 새 닉네임을 씁니다.");
    } catch (reason) {
      setNickError(errorMessage(reason, "닉네임을 바꾸지 못했습니다."));
    } finally {
      setNickBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (pwBusy) return;
    setPwDone("");
    if (!current) return setPwError("현재 비밀번호를 입력하세요.");
    const problem = passwordError(next, confirm);
    if (problem) return setPwError(problem);
    setPwBusy(true);
    setPwError("");
    try {
      await bridge.changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwDone("비밀번호를 바꿨습니다.");
    } catch (reason) {
      setPwError(errorMessage(reason, "비밀번호를 바꾸지 못했습니다."));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="settings-group" aria-label="프로필">
      <div className="settings-group-label">
        <span>PROFILE</span>
        <i />
      </div>
      <form className="settings-row wide settings-row-form" onSubmit={changeNickname} noValidate>
        <div>
          <div className="settings-row-label">닉네임 변경</div>
          <div className="settings-row-hint">{NICKNAME_HINT} · 로그인할 때 쓰는 이름도 함께 바뀝니다</div>
          <Feedback error={nickError} done={nickDone} />
        </div>
        <div className="settings-row-value settings-fields">
          <input
            className="settings-input"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setNickError("");
              setNickDone("");
            }}
            aria-label="새 닉네임"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
          />
          <Button type="submit" variant="default" disabled={nickBusy || !nick || nick === session.nickname} aria-busy={nickBusy}>
            변경
          </Button>
        </div>
      </form>
      <form className="settings-row wide settings-row-form" onSubmit={changePassword} noValidate>
        <div>
          <div className="settings-row-label">비밀번호 변경</div>
          <div className="settings-row-hint">새 비밀번호는 {PASSWORD_MIN}자 이상입니다</div>
          <Feedback error={pwError} done={pwDone} />
        </div>
        <div className="settings-row-value settings-fields stack">
          {(
            [
              ["현재 비밀번호", current, setCurrent, "current-password"],
              ["새 비밀번호", next, setNext, "new-password"],
              ["새 비밀번호 확인", confirm, setConfirm, "new-password"],
            ] as const
          ).map(([label, value, setter, autoComplete]) => (
            <input
              key={label}
              className="settings-input"
              type="password"
              value={value}
              onChange={(event) => {
                setter(event.target.value);
                setPwError("");
                setPwDone("");
              }}
              placeholder={label}
              aria-label={label}
              autoComplete={autoComplete}
            />
          ))}
          <Button type="submit" variant="default" disabled={pwBusy} aria-busy={pwBusy}>
            변경
          </Button>
        </div>
      </form>
    </div>
  );
};
