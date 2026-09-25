import { Fragment, useMemo, type CSSProperties } from "react";

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
  onSelect: (item: T) => void;
};

type Folder<T> = { name: string; path: string; children: Map<string, Folder<T>>; items: T[] };

function countItems<T>(folder: Folder<T>): number {
  return folder.items.length + [...folder.children.values()].reduce((count, child) => count + countItems(child), 0);
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

export function ScenarioSidebarTree<T extends ScenarioSidebarEntry>({ items, selectedId, disabled = false, kind, onSelect }: Props<T>) {
  const tree = useMemo(() => makeTree(items), [items]);
  const renderFolder = (folder: Folder<T>, depth: number) => {
    const children = [...folder.children.values()].sort((left, right) => left.name.localeCompare(right.name, "ko"));
    const rows = [...folder.items].sort((left, right) => left.name.localeCompare(right.name, "ko"));
    return <details className="api-sidebar-folder" key={folder.path} open={depth === 0}>
      <summary style={{ "--folder-depth": depth } as CSSProperties}>
        <span>{folder.name}</span><small>{countItems(folder)}</small>
      </summary>
      <div className="api-sidebar-folder-content">
        {rows.map(item => <button type="button" key={item.id} disabled={disabled} className={`api-sidebar-entry${selectedId === item.id ? " selected" : ""}`} onClick={() => onSelect(item)}>
          <strong>{item.name}</strong>
          {item.draft && <span className="api-sidebar-entry-meta">
            {item.draft && <small className="api-sidebar-draft">초안</small>}
          </span>}
        </button>)}
        {children.map(child => <Fragment key={child.path}>{renderFolder(child, depth + 1)}</Fragment>)}
      </div>
    </details>;
  };

  const folders = [...tree.children.values()].sort((left, right) => left.name === "미분류" ? -1 : right.name === "미분류" ? 1 : left.name.localeCompare(right.name, "ko"));
  return <div className={`api-sidebar-tree api-sidebar-tree-${kind}`}>
    {folders.map(folder => renderFolder(folder, 0))}
    {!items.length && <p className="api-sidebar-empty">{kind === "scenario" ? "조건에 맞는 시나리오가 없습니다." : "조건에 맞는 스위트가 없습니다."}</p>}
  </div>;
}
