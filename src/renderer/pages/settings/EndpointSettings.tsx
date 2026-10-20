import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { EndpointKind, ProjectEndpoint, ProjectEnvironment, ProjectSettings } from "../../shared/model/electron-api/auth";
import { errorMessage, type AuthAccount } from "../auth/model";
import {
  addEnvironment,
  cellKey,
  displayHost,
  fromDraft,
  swaggerUrl,
  toDraft,
  validateDraft,
  type MatrixDraft,
} from "./endpoint-matrix-model";
import { ConfirmDialog } from "./SettingsDialog";
import { InlineConfirm, SavedNote } from "./SettingsSection";

const SAVED = "저장했습니다 · 팀원에게 바로 반영됩니다";
const KINDS: Array<[EndpointKind, string]> = [
  ["web", "웹"],
  ["api", "API"],
];

type EditorCell = { baseUrl: string; specUrl: string };
type Editor = {
  id: string;
  name: string;
  kind: EndpointKind;
  isNew: boolean;
  cells: Record<string, EditorCell>;
  /** 환경별로 스웨거 주소를 직접 적었는지. 아니면 기본 주소 + /v3/api-docs. */
  custom: Record<string, boolean>;
};

const newId = () => crypto.randomUUID();
const hasUrl = (draft: MatrixDraft, environmentId: string) =>
  draft.endpoints.some((endpoint) => draft.cells[cellKey(endpoint.id, environmentId)]?.baseUrl.trim());

/**
 * 엔드포인트 섹션(Checkly Settings v10): 서버 × 환경 주소 목록. 행을 눌러 그 자리에서 고치고,
 * 저장하면 표 전체를 한 번에 보낸다. 다른 팀원이 먼저 고쳤으면 main이 거절한 문장과 새로 불러오기를 보여준다.
 */
export const EndpointSettings = ({ account }: { account: AuthAccount }) => {
  const { bridge } = account;
  const [base, setBase] = useState<MatrixDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [envDraft, setEnvDraft] = useState<ProjectEnvironment[] | null>(null);
  const [envDelete, setEnvDelete] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProjectEndpoint | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const apply = (settings: ProjectSettings) => setBase(toDraft(settings));
  const flash = (message: string) => {
    setSaved(message);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(""), 2400);
  };

  const load = async () => {
    setBusy(true);
    try {
      apply(await bridge.getProjectSettings());
      setLoadError("");
      setSaveError("");
      setProblem("");
      setEditor(null);
      setEnvDraft(null);
    } catch (reason) {
      const message = errorMessage(reason, "엔드포인트 설정을 불러오지 못했습니다.");
      if (base) setSaveError(message);
      else setLoadError(message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // 프로젝트가 바뀌면 앱을 다시 불러오므로 처음 한 번만 읽는다.
  }, [bridge]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 검사 → 저장. 실패하면 문장을 남기고 false. */
  const persist = async (next: MatrixDraft, done = SAVED): Promise<boolean> => {
    if (busy) return false;
    const invalid = validateDraft(next).message;
    if (invalid) {
      setProblem(invalid);
      return false;
    }
    setBusy(true);
    setProblem("");
    setSaveError("");
    try {
      apply(await bridge.saveProjectSettings(fromDraft(next)));
      flash(done);
      return true;
    } catch (reason) {
      setSaveError(errorMessage(reason, "엔드포인트 설정을 저장하지 못했습니다."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!base) {
    return (
      <div className="endpoint-state">
        {loadError ? (
          <div className="settings-error" role="alert">
            <span className="msi" aria-hidden="true">error</span>
            {loadError}
            <Button variant="secondary" className="setting-chip" onClick={() => void load()} disabled={busy}>
              다시 불러오기
            </Button>
          </div>
        ) : (
          "불러오는 중…"
        )}
      </div>
    );
  }

  const environments = base.environments;
  const gridStyle = { "--env-count": Math.max(environments.length, 1) } as CSSProperties;

  const openEditor = (endpoint: ProjectEndpoint | null) => {
    const id = endpoint?.id ?? newId();
    const cells: Record<string, EditorCell> = {};
    const custom: Record<string, boolean> = {};
    for (const environment of environments) {
      const cell = base.cells[cellKey(id, environment.id)];
      cells[environment.id] = { baseUrl: cell?.baseUrl ?? "", specUrl: cell?.specUrl ?? "" };
      custom[environment.id] = !!cell?.specUrl && cell.specUrl !== swaggerUrl(cell.baseUrl);
    }
    setEditor({ id, name: endpoint?.name ?? "", kind: endpoint?.kind ?? "web", isNew: !endpoint, cells, custom });
    setEnvDraft(null);
    setEnvDelete(null);
    setProblem("");
    setSaved("");
  };

  const editorDraft = (current: Editor): MatrixDraft => {
    const existing = base.endpoints.find((endpoint) => endpoint.id === current.id);
    const endpoint: ProjectEndpoint = { ...(existing ?? { position: base.endpoints.length }), id: current.id, name: current.name, kind: current.kind };
    const cells = { ...base.cells };
    for (const environment of environments) {
      const key = cellKey(current.id, environment.id);
      const cell = current.cells[environment.id] ?? { baseUrl: "", specUrl: "" };
      const baseUrl = cell.baseUrl.trim();
      const specUrl =
        current.kind === "api" && baseUrl ? (current.custom[environment.id] && cell.specUrl.trim() ? cell.specUrl.trim() : swaggerUrl(baseUrl)) : "";
      cells[key] = { baseUrl, specUrl, updatedAt: base.cells[key]?.updatedAt };
    }
    return {
      ...base,
      endpoints: existing ? base.endpoints.map((item) => (item.id === endpoint.id ? endpoint : item)) : [...base.endpoints, endpoint],
      cells,
    };
  };

  const saveEditor = async () => {
    if (!editor || !editor.name.trim()) return;
    if (await persist(editorDraft(editor))) setEditor(null);
  };

  const setEditorCell = (environmentId: string, patch: Partial<EditorCell>) =>
    setEditor((current) =>
      current && { ...current, cells: { ...current.cells, [environmentId]: { ...(current.cells[environmentId] ?? { baseUrl: "", specUrl: "" }), ...patch } } },
    );

  const startEnvEdit = () => {
    setEnvDraft(environments.map((environment) => ({ ...environment })));
    setEditor(null);
    setProblem("");
    setSaved("");
  };
  const finishEnvEdit = async () => {
    if (!envDraft) return;
    if (await persist({ ...base, environments: envDraft })) {
      setEnvDraft(null);
      setEnvDelete(null);
    }
  };
  const removeEnvironment = (id: string) => {
    setEnvDraft((current) => current && current.filter((environment) => environment.id !== id));
    setEnvDelete(null);
  };
  const deleting = envDelete ? envDraft?.find((environment) => environment.id === envDelete) : undefined;
  const deletingCount = deleting
    ? base.endpoints.filter((endpoint) => base.cells[cellKey(endpoint.id, deleting.id)]?.baseUrl.trim()).length
    : 0;

  const rows = editor?.isNew ? [...base.endpoints, null] : base.endpoints;

  return (
    <div className="endpoint-settings">
      {envDraft ? (
        <div className="endpoint-env-edit">
          <div className="endpoint-env-chips">
            <span className="endpoint-caption">환경</span>
            {envDraft.map((environment) => (
              <Input
                  key={environment.id}
                  mono
                  wrapperClassName="endpoint-env-chip"
                  value={environment.name}
                  onChange={(event) =>
                    setEnvDraft((current) => current && current.map((item) => (item.id === environment.id ? { ...item, name: event.target.value } : item)))
                  }
                  placeholder="환경 이름을 입력해주세요"
                  aria-label="환경 이름"
                  spellCheck={false}
                  maxLength={100}
                  trailing={
                    <Button
                      className="endpoint-env-remove"
                      aria-label={`환경 ${environment.name || "(이름 없음)"} 삭제`}
                      onClick={() => (hasUrl(base, environment.id) ? setEnvDelete(environment.id) : removeEnvironment(environment.id))}
                    >
                      <span className="msi" aria-hidden="true">close</span>
                    </Button>
                  }
                />
            ))}
            <Button
              variant="ghost" className="setting-link"
              onClick={() => setEnvDraft((current) => current && addEnvironment({ ...base, environments: current })[0].environments)}
            >
              <span className="msi" aria-hidden="true">add</span>
              추가
            </Button>
            <Button variant="primary" className="setting-chip push" onClick={() => void finishEnvEdit()} disabled={busy} aria-busy={busy}>
              완료
            </Button>
          </div>
          {deleting && (
            <InlineConfirm
              message={`${deleting.name || "이름 없음"} 환경에 등록된 주소 ${deletingCount}개도 함께 지워집니다`}
              confirmLabel="삭제"
              danger
              onCancel={() => setEnvDelete(null)}
              onConfirm={() => removeEnvironment(deleting.id)}
            />
          )}
          {problem && <EndpointProblem text={problem} />}
        </div>
      ) : (
        <div className="endpoint-grid endpoint-head" style={gridStyle}>
          <span className="endpoint-caption">서버</span>
          {environments.map((environment) => (
            <span key={environment.id} className="endpoint-env-name">
              {environment.name || "이름 없음"}
            </span>
          ))}
          {!environments.length && <span className="endpoint-caption">환경 없음</span>}
          <Button variant="ghost" className="setting-link end" onClick={startEnvEdit}>
            환경 편집
          </Button>
        </div>
      )}

      {rows.map((endpoint) =>
        editor && (endpoint === null || editor.id === endpoint.id) ? (
          <div key={editor.id} className="endpoint-editor">
            <div className="endpoint-editor-head">
              <Input
                className="endpoint-name-input"
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                placeholder="서버 이름을 입력해주세요"
                aria-label="서버 이름"
                spellCheck={false}
                maxLength={100}
                autoFocus={editor.isNew}
              />
              <div className="endpoint-kind" role="radiogroup" aria-label="서버 종류">
                {KINDS.map(([kind, label]) => (
                  <Button
                    key={kind}
                    role="radio"
                    aria-checked={editor.kind === kind}
                    className={editor.kind === kind ? "on" : undefined}
                    onClick={() => setEditor({ ...editor, kind })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {endpoint && (
                <Button variant="ghost" className="setting-link danger push" onClick={() => setRemoving(endpoint)}>
                  <span className="msi" aria-hidden="true">delete</span>
                  서버 삭제
                </Button>
              )}
            </div>
            <div className="endpoint-editor-cells">
              {environments.map((environment) => {
                const label = environment.name || "이름 없음";
                const cell = editor.cells[environment.id] ?? { baseUrl: "", specUrl: "" };
                const api = editor.kind === "api";
                const custom = api && editor.custom[environment.id];
                return (
                  <div key={environment.id} className="endpoint-editor-row">
                    <span className="endpoint-editor-env">{label}</span>
                    <div className="endpoint-editor-fields">
                      <Input
                        mono
                        value={cell.baseUrl}
                        onChange={(event) => setEditorCell(environment.id, { baseUrl: event.target.value })}
                        placeholder="주소를 입력해주세요 (https://…)"
                        aria-label={`${label} 주소`}
                        spellCheck={false}
                      />
                      {api && !custom && cell.baseUrl.trim() && (
                        <div className="endpoint-swagger">
                          <span>스웨거</span>
                          <code>{displayHost(swaggerUrl(cell.baseUrl))}</code>
                          <Button
                            className="setting-inline-link"
                            aria-label={`${label} 스웨거 주소 변경`}
                            onClick={() => {
                              setEditor({ ...editor, custom: { ...editor.custom, [environment.id]: true } });
                              if (!cell.specUrl) setEditorCell(environment.id, { specUrl: swaggerUrl(cell.baseUrl) });
                            }}
                          >
                            변경
                          </Button>
                        </div>
                      )}
                      {custom && (
                        <div className="endpoint-swagger-custom">
                          <Input
                            mono
                            value={cell.specUrl}
                            onChange={(event) => setEditorCell(environment.id, { specUrl: event.target.value })}
                            placeholder="스웨거 문서 주소를 입력해주세요"
                            aria-label={`${label} 스웨거 주소`}
                            spellCheck={false}
                          />
                          <Button variant="secondary" className="setting-chip" onClick={() => setEditor({ ...editor, custom: { ...editor.custom, [environment.id]: false } })}>
                            자동
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!environments.length && <span className="setting-muted">환경을 먼저 추가하세요</span>}
            </div>
            {problem && <EndpointProblem text={problem} />}
            <div className="endpoint-editor-actions">
              <Button variant="secondary" className="setting-chip" onClick={() => (setEditor(null), setProblem(""))}>
                취소
              </Button>
              <Button variant="primary" className="setting-chip" onClick={() => void saveEditor()} disabled={!editor.name.trim() || busy} aria-busy={busy}>
                {busy ? "저장 중…" : "저장"}
              </Button>
            </div>
          </div>
        ) : endpoint ? (
          <Button key={endpoint.id} className="endpoint-grid endpoint-row" style={gridStyle} aria-label={`${endpoint.name || "이름 없음"} 편집`} onClick={() => openEditor(endpoint)}>
            <span className="endpoint-row-name">
              <span>{endpoint.name || "이름 없음"}</span>
              <span className="endpoint-kind-badge">{endpoint.kind === "web" ? "WEB" : "API"}</span>
            </span>
            {environments.map((environment) => {
              const url = base.cells[cellKey(endpoint.id, environment.id)]?.baseUrl.trim() ?? "";
              return (
                <span key={environment.id} className={`endpoint-cell${url ? " set" : ""}`}>
                  <i aria-hidden="true" />
                  <span title={url || undefined}>{url ? displayHost(url) : "미설정"}</span>
                </span>
              );
            })}
            {!environments.length && <span />}
            <span className="msi endpoint-row-edit" aria-hidden="true">edit</span>
          </Button>
        ) : null,
      )}

      {!rows.length && <div className="endpoint-empty">등록된 서버가 없습니다</div>}

      <div className="endpoint-footer">
        <Button variant="ghost" className="setting-link flush" onClick={() => openEditor(null)} disabled={!!editor?.isNew}>
          <span className="msi" aria-hidden="true">add</span>
          서버 추가
        </Button>
        <SavedNote text={saved} />
      </div>
      {saveError && (
        <div className="settings-callout" data-tone="fail" role="alert">
          <span>{saveError}</span>
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            새로 불러오기
          </Button>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          eyebrow="SERVER"
          title={`${removing.name || "이 서버"}를 삭제할까요?`}
          description="모든 환경에 등록된 이 서버의 주소가 함께 지워지고 팀원에게 바로 반영됩니다. 이 서버를 쓰던 시나리오는 다른 서버로 다시 연결해야 합니다."
          confirmLabel="삭제"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const id = removing.id;
            const ok = await persist({ ...base, endpoints: base.endpoints.filter((endpoint) => endpoint.id !== id) }, "서버를 삭제했습니다");
            if (!ok) throw new Error("서버를 삭제하지 못했습니다.");
            setEditor(null);
          }}
        />
      )}
    </div>
  );
};

const EndpointProblem = ({ text }: { text: string }) => (
  <div className="settings-error" role="alert">
    <span className="msi" aria-hidden="true">error</span>
    {text}
  </div>
);
