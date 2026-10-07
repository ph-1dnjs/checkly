import { useCallback, useEffect, useState } from "react";
import type { ProjectInfo } from "../../shared/model/electron-api/auth";
import { errorMessage, type AuthAccount } from "../auth/model";

export type ProjectInfoState = {
  info: ProjectInfo | null;
  error: string;
  reload: () => void;
  update: (patch: (info: ProjectInfo) => ProjectInfo) => void;
};

/** 계정 카드와 PROJECT 그룹이 같이 쓰는 프로젝트 정보. 로그인하지 않았으면 부르지 않는다. */
export const useProjectInfo = (account: AuthAccount | null | undefined): ProjectInfoState => {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const bridge = account?.bridge;
  const projectId = account?.session.projectId;
  const nickname = account?.session.nickname;

  useEffect(() => {
    if (!bridge || !projectId) return;
    let alive = true;
    bridge.getProject().then(
      (project) => {
        if (!alive) return;
        setInfo(project);
        setError("");
      },
      (reason) => alive && setError(errorMessage(reason, "프로젝트 정보를 불러오지 못했습니다.")),
    );
    return () => {
      alive = false;
    };
    // 닉네임이 바뀌면 멤버 목록도 다시 읽는다.
  }, [bridge, projectId, nickname, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const update = useCallback((patch: (info: ProjectInfo) => ProjectInfo) => setInfo((current) => (current ? patch(current) : current)), []);

  return { info: account ? info : null, error, reload, update };
};
