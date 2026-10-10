import { useEffect, useMemo, useState } from "react";
import { Button } from "../../shared/ui/Button";
import type { EndpointKind, ProjectSettings } from "../../shared/model/electron-api/auth";
import { errorMessage, type AuthAccount } from "../auth/model";
import {
  addEndpoint,
  addEnvironment,
  cellKey,
  fromDraft,
  sameSettings,
  toDraft,
  validateDraft,
  type MatrixCell,
  type MatrixDraft,
} from "./endpoint-matrix-model";

const EMPTY: MatrixDraft = { endpoints: [], environments: [], cells: {} };
const KINDS: Array<[EndpointKind, string]> = [
  ["web", "웹"],
  ["api", "API"],
];

/**
 * 엔드포인트(행) × 환경(열) 주소표. 전체를 한 번에 저장하고, 다른 팀원이 먼저 고쳤으면
 * main이 거절한 문장을 보여주고 새로 불러오기를 제안한다.
 */
export const EndpointMatrix = ({ account }: { account: AuthAccount }) => {
  const { bridge } = account;
  const [base, setBase] = useState<MatrixDraft | null>(null);
  const [draft, setDraft] = useState<MatrixDraft>(EMPTY);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const apply = (settings: ProjectSettings) => {
    const next = toDraft(settings);
    setBase(next);
    setDraft(next);
    setSaveError("");
    setShowProblems(false);
  };

  const load = async () => {
    setBusy(true);
    try {
      apply(await bridge.getProjectSettings());
      setLoadError("");
    } catch (reason) {
      const message = errorMessage(reason, "엔드포인트 설정을 불러오지 못했습니다.");
      setLoadError(message);
      setSaveError(message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // 프로젝트가 바뀌면 앱을 다시 불러오므로 처음 한 번만 읽는다.
  }, [bridge]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const dirty = base ? !sameSettings(draft, base) : false;

  const change = (next: MatrixDraft) => {
    setDraft(next);
    setSaved(false);
  };
  const renameEndpoint = (id: string, name: string) =>
    change({ ...draft, endpoints: draft.endpoints.map((endpoint) => (endpoint.id === id ? { ...endpoint, name } : endpoint)) });
  const setKind = (id: string, kind: EndpointKind) =>
    change({ ...draft, endpoints: draft.endpoints.map((endpoint) => (endpoint.id === id ? { ...endpoint, kind } : endpoint)) });
  const removeEndpoint = (id: string) => change({ ...draft, endpoints: draft.endpoints.filter((endpoint) => endpoint.id !== id) });
  const renameEnvironment = (id: string, name: string) =>
    change({ ...draft, environments: draft.environments.map((environment) => (environment.id === id ? { ...environment, name } : environment)) });
  const removeEnvironment = (id: string) =>
    change({ ...draft, environments: draft.environments.filter((environment) => environment.id !== id) });
  const setCell = (key: string, patch: Partial<MatrixCell>) => {
    const current = draft.cells[key] ?? { baseUrl: "", specUrl: "" };
    change({ ...draft, cells: { ...draft.cells, [key]: { ...current, ...patch } } });
  };

  const save = async () => {
    if (busy) return;
    if (validation.message) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      apply(await bridge.saveProjectSettings(fromDraft(draft)));
      setSaved(true);
    } catch (reason) {
      setSaveError(errorMessage(reason, "엔드포인트 설정을 저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  if (!base) {
    return (
      <div className="endpoint-matrix-state">
        {loadError ? (
          <div className="settings-error" role="alert">
            <span className="msi" aria-hidden="true">error</span>
            {loadError}
            <Button variant="default" onClick={() => void load()} disabled={busy}>
              다시 불러오기
            </Button>
          </div>
        ) : (
          "불러오는 중…"
        )}
      </div>
    );
  }

  const problem = showProblems ? validation.message : "";
  const columns = draft.environments.length;

  return (
    <div className="endpoint-matrix">
      <div className="endpoint-matrix-scroll" data-ck-scroll="light">
        <table aria-label="엔드포인트 × 환경 주소" style={{ minWidth: 176 + 190 * columns + 84 }}>
          <thead>
            <tr>
              <th scope="col" className="em-corner">
                엔드포인트 <span>환경 →</span>
              </th>
              {draft.environments.map((environment) => (
                <th key={environment.id} scope="col" className="em-env">
                  <div className="em-env-head">
                    <input
                      className="em-name"
                      value={environment.name}
                      onChange={(event) => renameEnvironment(environment.id, event.target.value)}
                      placeholder="환경 이름"
                      aria-label="환경 이름"
                      aria-invalid={showProblems && validation.environmentNames.has(environment.id)}
                      spellCheck={false}
                      maxLength={100}
                      autoFocus={focusId === environment.id}
                    />
                    <Button
                      className="em-icon"
                      onClick={() => removeEnvironment(environment.id)}
                      aria-label={`환경 ${environment.name || "(이름 없음)"} 삭제`}
                      title="환경 삭제"
                    >
                      <span className="msi" aria-hidden="true">close</span>
                    </Button>
                  </div>
                </th>
              ))}
              <th scope="col" className="em-add-col">
                <Button
                  className="em-add"
                  onClick={() => {
                    const [next, id] = addEnvironment(draft);
                    setFocusId(id);
                    change(next);
                  }}
                >
                  <span className="msi" aria-hidden="true">add</span>
                  환경
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.endpoints.map((endpoint) => (
              <tr key={endpoint.id}>
                <th scope="row" className="em-endpoint">
                  <div className="em-endpoint-head">
                    <input
                      className="em-name"
                      value={endpoint.name}
                      onChange={(event) => renameEndpoint(endpoint.id, event.target.value)}
                      placeholder="엔드포인트 이름"
                      aria-label="엔드포인트 이름"
                      aria-invalid={showProblems && validation.endpointNames.has(endpoint.id)}
                      spellCheck={false}
                      maxLength={100}
                      autoFocus={focusId === endpoint.id}
                    />
                    <Button
                      className="em-icon"
                      onClick={() => removeEndpoint(endpoint.id)}
                      aria-label={`엔드포인트 ${endpoint.name || "(이름 없음)"} 삭제`}
                      title="엔드포인트 삭제"
                    >
                      <span className="msi" aria-hidden="true">close</span>
                    </Button>
                  </div>
                  <div className="em-kind" role="radiogroup" aria-label={`${endpoint.name || "엔드포인트"} 종류`}>
                    {KINDS.map(([kind, label]) => (
                      <Button
                        key={kind}
                        role="radio"
                        aria-checked={endpoint.kind === kind}
                        className={endpoint.kind === kind ? "on" : undefined}
                        onClick={() => setKind(endpoint.id, kind)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </th>
                {draft.environments.map((environment) => {
                  const key = cellKey(endpoint.id, environment.id);
                  const cell = draft.cells[key];
                  const cellProblem = showProblems ? validation.cells[key] : undefined;
                  const where = `${endpoint.name || "엔드포인트"} · ${environment.name || "환경"}`;
                  return (
                    <td key={environment.id} className="em-cell">
                      <input
                        className="em-url"
                        value={cell?.baseUrl ?? ""}
                        onChange={(event) => setCell(key, { baseUrl: event.target.value })}
                        placeholder="미설정"
                        aria-label={`${where} 주소`}
                        aria-invalid={Boolean(cellProblem?.base)}
                        title={cell?.baseUrl || undefined}
                        spellCheck={false}
                      />
                      {endpoint.kind === "api" && (
                        <input
                          className="em-url spec"
                          value={cell?.specUrl ?? ""}
                          onChange={(event) => setCell(key, { specUrl: event.target.value })}
                          placeholder="스웨거 주소 (선택)"
                          aria-label={`${where} 스웨거 주소`}
                          aria-invalid={Boolean(cellProblem?.spec)}
                          title={cell?.specUrl || undefined}
                          spellCheck={false}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="em-add-col" />
              </tr>
            ))}
            {!draft.endpoints.length && (
              <tr>
                <td className="em-empty" colSpan={columns + 2}>
                  아직 엔드포인트가 없습니다. 프론트(웹)·백엔드(API)처럼 주소가 다른 서버를 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="em-footer">
        <Button
          className="em-add dashed"
          onClick={() => {
            const [next, id] = addEndpoint(draft);
            setFocusId(id);
            change(next);
          }}
        >
          <span className="msi" aria-hidden="true">add</span>
          엔드포인트 추가
        </Button>
        <span className="em-status" aria-live="polite">
          {saved ? "저장했습니다" : dirty ? "저장하지 않은 변경 사항" : ""}
        </span>
        <Button variant="default" onClick={() => change(base)} disabled={!dirty || busy}>
          되돌리기
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || busy} aria-busy={busy}>
          {busy ? "저장 중…" : "저장"}
        </Button>
      </div>
      {(problem || saveError) && (
        <div className="settings-callout" data-tone="fail" role="alert">
          <span>{saveError || problem}</span>
          {saveError && (
            <Button variant="default" onClick={() => void load()} disabled={busy}>
              새로 불러오기
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
