import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import { CopyButton } from "../auth/AuthFields";
import { errorMessage, formatDate, roleLabel, type AuthAccount } from "../auth/model";
import { ProjectSwitchModal } from "./ProjectSwitchModal";
import type { ProjectInfoState } from "./useProjectInfo";

/** 설정 맨 위 계정 카드: 왼쪽 어두운 면(이니셜·닉네임·역할·로그아웃), 오른쪽 소속 프로젝트·코드. */
export const AccountCard = ({ account, project }: { account: AuthAccount; project: ProjectInfoState }) => {
  const { session } = account;
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const info = project.info;
  const meta = info ? `팀원 ${info.members.length}명 · 생성 ${formatDate(info.createdAt)}` : project.error || "불러오는 중…";

  const signOut = async () => {
    setSigningOut(true);
    setError("");
    try {
      await account.signOut();
    } catch (reason) {
      setError(errorMessage(reason, "로그아웃하지 못했습니다."));
      setSigningOut(false);
    }
  };

  return (
    <section className="account-card" aria-label="계정" data-screen-label="설정 · 계정 카드">
      <div className="account-card-side">
        <div className="account-avatar" aria-hidden="true">
          {(session.nickname || "?").charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="account-nick">{session.nickname}</div>
          <div className="account-role">{roleLabel(session.role)}</div>
        </div>
        <Button className="account-logout" onClick={() => void signOut()} disabled={signingOut}>
          <span className="msi" aria-hidden="true">logout</span>
          로그아웃
        </Button>
        {error && (
          <div className="account-side-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="account-card-main">
        <div className="account-row">
          <span className="account-row-label">소속 프로젝트</span>
          <div className="account-row-body">
            <div className="account-project" title={session.projectCode}>
              {session.projectCode}
            </div>
            <div className="account-meta">{meta}</div>
          </div>
          <Button className="account-chip" onClick={() => setSwitching(true)}>
            <span className="msi" aria-hidden="true">swap_horiz</span>
            프로젝트 변경
          </Button>
        </div>
        <div className="account-row">
          <span className="account-row-label">프로젝트 코드</span>
          <span className="account-code" title={session.projectCode}>
            {session.projectCode}
          </span>
          <CopyButton className="account-chip" value={session.projectCode} subject="프로젝트 코드" />
        </div>
      </div>
      {switching && <ProjectSwitchModal account={account} onClose={() => setSwitching(false)} />}
    </section>
  );
};
