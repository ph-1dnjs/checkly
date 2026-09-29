import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";

type Props = {
  groupPath: string[];
  existingGroupPaths: string[][];
  disabled?: boolean;
  onGroupPathChange: (path: string[]) => void;
};

const pathKey = (path: string[]) => JSON.stringify(path);
const pathLabel = (path: string[]) => path.join(" › ");

export function SidebarMetadataFields({ groupPath, existingGroupPaths, disabled = false, onGroupPathChange }: Props) {
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [parentPath, setParentPath] = useState<string[]>(groupPath);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [localPaths, setLocalPaths] = useState<string[][]>([]);
  const folderRef = useRef<HTMLDivElement>(null);
  const paths = useMemo(() => {
    const all = [...existingGroupPaths, ...localPaths, groupPath].filter(path => path.length > 0);
    const unique = new Map<string, string[]>();
    for (const path of all) for (let depth = 1; depth <= path.length; depth++) unique.set(pathKey(path.slice(0, depth)), path.slice(0, depth));
    return [...unique.values()].sort((left, right) => pathLabel(left).localeCompare(pathLabel(right), "ko"));
  }, [existingGroupPaths, groupPath, localPaths]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!folderRef.current?.contains(event.target as Node)) setCreatingFolder(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreatingFolder(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onKeyDown); };
  }, []);

  const createFolder = () => {
    const segment = folderName.trim();
    if (!segment) { setFolderError("폴더 이름을 입력하세요."); return; }
    if (segment.includes("/")) { setFolderError("폴더 이름에는 /를 사용할 수 없습니다."); return; }
    if (segment.length > 80) { setFolderError("폴더 이름은 80자 이하로 입력하세요."); return; }
    const nextPath = [...parentPath, segment];
    const existing = paths.find(path => pathKey(path).toLocaleLowerCase() === pathKey(nextPath).toLocaleLowerCase());
    if (existing) {
      onGroupPathChange(existing);
      setCreatingFolder(false);
      setFolderName("");
      setFolderError("");
      return;
    }
    if (nextPath.length > 10 || pathLabel(nextPath).length > 200) { setFolderError("그룹 경로는 10단계, 200자까지 만들 수 있습니다."); return; }
    setLocalPaths(current => [...current, nextPath]);
    onGroupPathChange(nextPath);
    setFolderName("");
    setFolderError("");
    setCreatingFolder(false);
  };

  return <section className="api-sidebar-metadata-fields" aria-label="시나리오 분류">
    <div className="api-sidebar-group-field">
      <span className="api-sidebar-field-label">그룹</span>
      <div className="api-sidebar-control-row">
        <select aria-label="그룹" value={pathKey(groupPath)} disabled={disabled} onChange={event => onGroupPathChange(event.target.value ? JSON.parse(event.target.value) as string[] : [])}>
          <option value="">그룹 없음</option>
          {paths.map(path => <option value={pathKey(path)} key={pathKey(path)}>{pathLabel(path)}</option>)}
        </select>
        <div className="api-sidebar-popover-anchor" ref={folderRef}>
          <button type="button" className="api-sidebar-add-button" disabled={disabled} aria-label="새 그룹 폴더 만들기" aria-expanded={creatingFolder} onClick={() => { setCreatingFolder(value => !value); setParentPath(groupPath); setFolderError(""); }}><Icon name="add" size={15} /><span>새 폴더</span></button>
          {creatingFolder && <div className="api-sidebar-popover api-sidebar-folder-create" role="group" aria-label="새 그룹 폴더 만들기">
            <label>상위 폴더<select value={pathKey(parentPath)} disabled={disabled} onChange={event => setParentPath(event.target.value ? JSON.parse(event.target.value) as string[] : [])}>
              <option value="">최상위</option>
              {paths.map(path => <option value={pathKey(path)} key={pathKey(path)}>{pathLabel(path)}</option>)}
            </select></label>
            <label>폴더 이름<input value={folderName} disabled={disabled} maxLength={80} onChange={event => { setFolderName(event.target.value); setFolderError(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); createFolder(); } }} placeholder="예: 승인" /></label>
            <button type="button" disabled={disabled || !folderName.trim()} onClick={createFolder}>만들기</button>
            {folderError && <small role="alert">{folderError}</small>}
          </div>}
        </div>
      </div>
    </div>
  </section>;
}
