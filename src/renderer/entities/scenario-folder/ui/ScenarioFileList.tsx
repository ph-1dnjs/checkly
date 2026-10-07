import { Button } from "../../../shared/ui/Button";
import type { Scenario } from "../../../shared/model/scenario";
import type { ScenarioFileEntry } from "../model/useScenarioFolder";

type Props = {
  files: ScenarioFileEntry[];
  fileCache: Record<string, Scenario[]>;
  activePath: string | null;
  pickedCountByFile: Record<string, number>;
  onSelect: (filePath: string) => void;
  onChooseFolder: () => void;
};

/** 시나리오 작업공간 왼쪽 파일 열. 편집 탭과 실행 대상 선택이 같은 목록을 쓴다. */
export const ScenarioFileList = ({
  files,
  fileCache,
  activePath,
  pickedCountByFile,
  onSelect,
  onChooseFolder,
}: Props) => (
  <aside className="scenario-files" data-ck-scroll="light">
    <div className="scenario-files-label">
      <span>파일</span>
      <Button onClick={onChooseFolder}>폴더 변경</Button>
    </div>
    {files.length === 0 && (
      <p className="scenario-files-empty">
        시나리오 폴더를 선택하면 .md 파일 목록이 여기에 표시됩니다.
      </p>
    )}
    {files.map((file) => {
      const picked = pickedCountByFile[file.path] ?? 0;
      return (
        <Button
          key={file.path}
          className={file.path === activePath ? "active" : ""}
          onClick={() => onSelect(file.path)}
        >
          <span className="msi" aria-hidden="true">description</span>
          <div>
            <strong>{file.name}</strong>
            <small>
              {fileCache[file.path] ? `${fileCache[file.path].length}개 시나리오` : "…"}
              {" · "}
              {new Date(file.updatedAt).toLocaleDateString("ko-KR")}
            </small>
            <code title={file.path}>{file.path}</code>
          </div>
          {picked > 0 && <em>{picked} 선택</em>}
        </Button>
      );
    })}
  </aside>
);
