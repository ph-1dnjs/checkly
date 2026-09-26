import { Fragment, useMemo } from "react";
import { Icon } from "../../shared/ui/Icon";

export type ScenarioSidebarEntry = {
  id: string;
  name: string;
  groupPath?: string[];
  draft?: boolean;
};

type Props<T extends ScenarioSidebarEntry> = {
  items: T[];
  selectedId?: string | null;
  disabled?: boolean;
  kind: "scenario" | "suite";
  /** Open every folder, e.g. while filtering. */
  expandAll?: boolean;
  onSelect: (item: T) => void;
};

type Folder<T> = { name: string; path: string; children: Map<string, Folder<T>>; items: T[] };

function countItems<T>(folder: Folder<T>): number {
  return folder.items.length + [...folder.children.values()].reduce((count, child) => count + countItems(child), 0);
}

function containsItem<T extends ScenarioSidebarEntry>(folder: Folder<T>, id: string | null | undefined): boolean {
  return Boolean(id) && (folder.items.some(item => item.id === id) || [...folder.children.values()].some(child => containsItem(child, id)));
}

function makeTree<T extends ScenarioSidebarEntry>(items: T[]): Folder<T> {
  const root: Folder<T> = { name: "", path: "", children: new Map(), items: [] };
  for (const item of items) {
    const segments = item.groupPath?.map(part => part.trim()).filter(Boolean) ?? [];
    const path = segments.length ? segments : ["미분류"];
    let folder = root;
    for (const segment of path) {
      let child = folder.children.get(segment);
      if (!child) {
        child = { name: segment, path: folder.path ? `${folder.path}/${segment}` : segment, children: new Map(), items: [] };
        folder.children.set(segment, child);
      }
      folder = child;
    }
    folder.items.push(item);
  }
  return root;
}

export function ScenarioSidebarTree<T extends ScenarioSidebarEntry>({ items, selectedId, disabled = false, kind, expandAll = false, onSelect }: Props<T>) {
  const tree = useMemo(() => makeTree(items), [items]);
  const renderRows = (folder: Folder<T>) => [...folder.items].sort((left, right) => left.name.localeCompare(right.name, "ko")).map(item =>
    <button type="button" key={item.id} disabled={disabled} className={`api-sidebar-entry${selectedId === item.id ? " selected" : ""}`} onClick={() => onSelect(item)}>
      <strong>{item.name}</strong>
      {item.draft && <span className="api-sidebar-entry-meta"><small className="api-sidebar-draft">초안</small></span>}
    </button>);
  const renderFolder = (folder: Folder<T>, depth: number) => {
    const children = [...folder.children.values()].sort((left, right) => left.name.localeCompare(right.name, "ko"));
    return <details className="api-sidebar-folder" key={folder.path} open={expandAll || depth === 0 || containsItem(folder, selectedId)}>
      <summary>
        <Icon name="expand_more" size={16} className="api-sidebar-chevron" /><span>{folder.name}</span><small>{countItems(folder)}</small>
      </summary>
      <div className="api-sidebar-folder-content">
        {renderRows(folder)}
        {children.map(child => <Fragment key={child.path}>{renderFolder(child, depth + 1)}</Fragment>)}
      </div>
    </details>;
  };

  const folders = [...tree.children.values()].sort((left, right) => left.name === "미분류" ? -1 : right.name === "미분류" ? 1 : left.name.localeCompare(right.name, "ko"));
  return <div className={`api-sidebar-tree api-sidebar-tree-${kind}`}>
    {/* Without any groups the lone "미분류" folder is just noise: list the items directly. */}
    {folders.length === 1 && folders[0].name === "미분류" && !folders[0].children.size
      ? <div className="api-sidebar-folder-content api-sidebar-flat">{renderRows(folders[0])}</div>
      : folders.map(folder => renderFolder(folder, 0))}
    {!items.length && <p className="api-sidebar-empty">{kind === "scenario" ? "조건에 맞는 시나리오가 없습니다." : "조건에 맞는 스위트가 없습니다."}</p>}
  </div>;
}
