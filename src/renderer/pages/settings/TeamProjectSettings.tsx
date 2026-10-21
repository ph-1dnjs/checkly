import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { IssuedResetCode, ProjectMember } from "../../shared/model/electron-api/auth";
import { CopyButton } from "../auth/AuthFields";
import { formatDate, type AuthAccount } from "../auth/model";
import { ShareSecretsRow } from "./ShareSecretsRow";
import { ConfirmDialog, SettingsDialog, SettingsSheet } from "./SettingsDialog";
import { SettingRow } from "./SettingsSection";
import type { ProjectInfoState } from "./useProjectInfo";

type Props = { account: AuthAccount; project: ProjectInfoState };

const PREVIEW = 5;
const AVATAR_TONES = 5;

const Avatar = ({ member, index, size }: { member: ProjectMember; index: number; size?: "lg" }) => (
  <span className={`member-avatar${size ? ` ${size}` : ""}`} data-tone={index % AVATAR_TONES} title={member.nickname} aria-hidden="true">
    {member.nickname.charAt(0).toUpperCase()}
  </span>
);

/** 팀 프로젝트 섹션(로그인했을 때만): 초대코드, 멤버, 비밀값 공유. */
export const TeamProjectSettings = ({ account, project }: Props) => {
  const { session, bridge } = account;
  const isOwner = session.role === "owner";
  const info = project.info;
  const members = info?.members ?? [];
  const [showMembers, setShowMembers] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "invite" } | { kind: "remove"; member: ProjectMember } | { kind: "reset"; member: ProjectMember } | null
  >(null);
  // 발급한 재설정 코드는 이 창에서 한 번만 보여 준다(서버에는 해시만 남는다).
  const [issued, setIssued] = useState<{ member: ProjectMember; reset: IssuedResetCode } | null>(null);

  const summary = members.length
    ? members.slice(0, 2).map((member) => member.nickname).join(", ") + (members.length > 2 ? ` 외 ${members.length - 2}명` : "")
    : "";

  return (
    <>
      {project.error && !info && (
        <div className="settings-callout" data-tone="fail" role="alert">
          <span>{project.error}</span>
          <Button variant="secondary" onClick={project.reload}>
            다시 불러오기
          </Button>
        </div>
      )}
      <SettingRow
        label="초대코드"
        action={
          <div className="setting-actions">
            <CopyButton className="setting-chip" value={info?.inviteCode ?? ""} subject="초대코드" />
            {isOwner && (
              <Button variant="secondary" className="setting-chip" disabled={!info} onClick={() => setConfirm({ kind: "invite" })}>
                재발급
              </Button>
            )}
          </div>
        }
      >
        <span className="settings-invite-code">{info?.inviteCode ?? "—"}</span>
      </SettingRow>
      <SettingRow
        label={info ? `멤버 ${members.length}명` : "멤버"}
        action={
          <Button variant="secondary" className="setting-chip" aria-haspopup="dialog" disabled={!info} onClick={() => setShowMembers(true)}>
            전체 보기
          </Button>
        }
      >
        {info ? (
          <div className="member-preview">
            <div className="member-stack">
              {members.slice(0, PREVIEW).map((member, index) => (
                <Avatar key={member.userId} member={member} index={index} />
              ))}
              {members.length > PREVIEW && <span className="member-avatar more">+{members.length - PREVIEW}</span>}
            </div>
            <span className="member-summary">{summary}</span>
          </div>
        ) : (
          <span className="setting-muted">불러오는 중…</span>
        )}
      </SettingRow>
      <ShareSecretsRow projectId={session.projectId} />

      {showMembers && info && (
        <MembersSheet
          members={members}
          selfId={session.userId}
          canRemove={isOwner}
          // 확인·코드 창이 떠 있으면 Esc는 그 창만 닫는다.
          onClose={() => !confirm && !issued && setShowMembers(false)}
          onRemove={(member) => setConfirm({ kind: "remove", member })}
          onIssueReset={(member) => setConfirm({ kind: "reset", member })}
        />
      )}
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
      {confirm?.kind === "reset" && (
        <ConfirmDialog
          eyebrow="PASSWORD RESET"
          title={`${confirm.member.nickname}님의 재설정 코드를 발급할까요?`}
          description="팀원이 로그인 화면의 비밀번호 찾기에서 이 코드로 새 비밀번호를 정합니다. 이전에 발급한 코드는 바로 쓸 수 없게 됩니다."
          confirmLabel="발급"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const member = confirm.member;
            setIssued({ member, reset: await bridge.issueResetCode(member.userId) });
          }}
        />
      )}
      {issued && <ResetCodeDialog member={issued.member} reset={issued.reset} onClose={() => setIssued(null)} />}
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
    </>
  );
};

type MembersProps = {
  members: ProjectMember[];
  selfId: string;
  canRemove: boolean;
  onClose: () => void;
  onRemove: (member: ProjectMember) => void;
  onIssueReset: (member: ProjectMember) => void;
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** 발급한 재설정 코드: 팀원에게 전달하도록 복사 버튼과 만료 시각을 보여준다. */
const ResetCodeDialog = ({ member, reset, onClose }: { member: ProjectMember; reset: IssuedResetCode; onClose: () => void }) => (
  <SettingsDialog
    eyebrow="PASSWORD RESET"
    title="재설정 코드를 발급했습니다"
    description={`${member.nickname}님에게 전달하세요. ${formatTime(reset.expiresAt)}까지 한 번만 쓸 수 있으며, 이 창을 닫으면 다시 볼 수 없습니다.`}
    onClose={onClose}
    footer={
      <Button variant="primary" className="settings-dialog-push" onClick={onClose} autoFocus>
        확인
      </Button>
    }
  >
    <div className="settings-dialog-body">
      <div className="reset-code-box">
        <span className="reset-code-value" aria-label="재설정 코드">
          {reset.code}
        </span>
        <CopyButton className="setting-chip" value={reset.code} subject="재설정 코드" />
      </div>
    </div>
  </SettingsDialog>
);

const MembersSheet = ({ members, selfId, canRemove, onClose, onRemove, onIssueReset }: MembersProps) => {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = members
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => !q || member.nickname.toLowerCase().includes(q));

  return (
    <SettingsSheet title={`멤버 ${members.length}명`} onClose={onClose}>
      <Input
          mono
          wrapperClassName="member-search"
          leading={<span className="msi" aria-hidden="true">search</span>}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="닉네임을 입력해주세요"
          aria-label="멤버 검색"
          spellCheck={false}
          autoComplete="off"
          autoFocus
      />
      <ul className="member-list" aria-label="멤버 목록">
        {filtered.map(({ member, index }) => (
          <li key={member.userId} className="member-row">
            <Avatar member={member} index={index} size="lg" />
            <span className="member-name">{member.nickname}</span>
            {member.role === "owner" && <span className="member-badge">관리자</span>}
            {member.userId === selfId && <span className="member-badge self">나</span>}
            <span className="member-meta">{formatDate(member.createdAt)} 참여</span>
            {canRemove && member.role !== "owner" && member.userId !== selfId && (
              <Button
                variant="secondary"
                className="member-reset"
                onClick={() => onIssueReset(member)}
                aria-label={`${member.nickname} 비밀번호 재설정 코드 발급`}
              >
                재설정 코드
              </Button>
            )}
            {canRemove && member.role !== "owner" && member.userId !== selfId && (
              <Button variant="danger" className="member-remove" onClick={() => onRemove(member)} aria-label={`${member.nickname} 내보내기`}>
                내보내기
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!filtered.length && <div className="member-empty">일치하는 멤버가 없습니다</div>}
    </SettingsSheet>
  );
};
