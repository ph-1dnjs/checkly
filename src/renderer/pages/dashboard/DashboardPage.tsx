import { useEffect, useMemo, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { Icon } from "../../shared/ui/Icon";
import { Modal } from "../../shared/ui/Modal";
import { formatClock, type RunRecord } from "../../shared/model/scenario";
import type { DashboardRun } from "../../../app/ipc/web-scenario/types";
import type { LiveSession } from "../../shared/model/electron-api/live-session";
import checklyMark from "../../assets/checkly-mark.png";
import { RECORDER_STORE_URL } from "../settings/BrandCarousel";

type Props = {
  projectId?: string;
  projectCode?: string;
  environments: { id: string; name: string }[];
  onOpenRun: () => void;
  onOpenApi: () => void;
  onOpenRecording: (id: string) => void;
  onOpenReport: (record: RunRecord) => void;
};
type Kind = "all" | "web" | "api";
type Status = DashboardRun["status"];
const labels: Record<Status, string> = { passed: "성공", failed: "실패", blocked: "설정 필요", cancelled: "취소" };
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDay = (key: string) => new Date(`${key}T00:00:00`);
const dateLabel = (date: Date) => `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, n: number) => { const copy = new Date(date); copy.setDate(copy.getDate() + n); return copy; };
const shortDuration = (run: DashboardRun) => Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000));
const count = (runs: DashboardRun[], status: Status) => runs.filter(run => run.status === status).length;

export const DashboardPage = ({ projectId, projectCode, environments, onOpenRun, onOpenApi, onOpenRecording, onOpenReport }: Props) => {
  const today = dayKey(new Date());
  const [period, setPeriod] = useState("7");
  const [from, setFrom] = useState(() => dayKey(addDays(localDay(today), -6)));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [week, setWeek] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [runs, setRuns] = useState<DashboardRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [apiDetail, setApiDetail] = useState<DashboardRun | null>(null);
  const [recordings, setRecordings] = useState<LiveSession[]>([]);
  const [recordingError, setRecordingError] = useState("");
  const valid = Boolean(from && to && from <= to && (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) <= 365 * 86400000);

  useEffect(() => {
    setRuns([]); setUpdated(null); setError("");
    if (!projectId || !valid) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    window.electronAPI.webScenarios.listDashboardRuns(localDay(from).toISOString(), addDays(localDay(to), 1).toISOString())
      .then(value => { if (alive) { setRuns(value); setUpdated(new Date()); } })
      .catch(() => { if (alive) setError("실행 기록을 불러오지 못했습니다. 네트워크와 데이터베이스 상태를 확인해 주세요."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, from, to, revision, valid]);
  useEffect(() => {
    setRecordings([]); setRecordingError("");
    if (!projectId) return;
    if (!window.electronAPI.liveSession) { setRecordingError("브라우저 기록 기능을 사용할 수 없습니다."); return; }
    let alive = true;
    window.electronAPI.liveSession.list("team").then(result => {
      if (!alive) return;
      if (result.error) setRecordingError("서버 브라우저 기록을 불러오지 못했습니다.");
      else setRecordings(result.sessions);
    }).catch(() => { if (alive) setRecordingError("서버 브라우저 기록을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [projectId, revision]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === "KeyP") {
        event.preventDefault(); if (!event.repeat) onOpenRun();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenRun]);
  const selectedRuns = useMemo(() => runs.filter(run => kind === "all" || run.type === kind).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [runs, kind]);
  const filtered = selectedRuns.filter(run => (status === "all" || run.status === status) && (environment === "all" || (environment === "none" ? !run.environmentId : run.environmentId === environment)) && (!selectedDay || dayKey(new Date(run.startedAt)) === selectedDay) && run.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pageCount);
  const sortedDays: Date[] = [];
  if (valid) for (let d = localDay(from); d <= localDay(to); d = addDays(d, 1)) sortedDays.push(d);
  const totalWeeks = Math.max(1, Math.ceil(sortedDays.length / 7));
  const safeWeek = Math.min(week, totalWeeks - 1);
  const days = sortedDays.slice(Math.max(0, sortedDays.length - (safeWeek + 1) * 7), sortedDays.length - safeWeek * 7);
  const envName = (id: string | null) => id ? environments.find(item => item.id === id)?.name ?? "삭제된 환경" : "환경 정보 없음";
  const open = async (run: DashboardRun) => {
    if (run.type === "api") { setApiDetail(run); return; }
    try {
      const record = await window.electronAPI.webScenarios.getRun(run.id);
      if (record) {
        const paths = JSON.parse(localStorage.getItem(`web-run-uploads:${projectId}:${record.id}`) ?? "{}") as Record<string, string>;
        const results = record.results.map(result => ({ ...result, scenario: { ...result.scenario, steps: result.scenario.steps.map(step => step.action === "fileUpload" ? { ...step, value: paths[`${result.scenario.id}:${step.databaseId ?? step.id}`] ?? "" } : step) } }));
        onOpenReport({ ...record, results, scenarios: results.map(result => result.scenario) });
      } else setError("실행 기록을 찾을 수 없습니다.");
    } catch { setError("실행 상세를 불러오지 못했습니다."); }
  };
  const choosePeriod = (value: string) => {
    setPeriod(value); setSelectedDay(""); setWeek(0); setPage(1);
    if (value !== "custom") { setTo(today); setFrom(dayKey(addDays(localDay(today), 1 - Number(value)))); }
  };
  const resetFilters = () => { setStatus("all"); setEnvironment("all"); setSearch(""); setSelectedDay(""); setPage(1); };
  const attention = selectedRuns.filter(run => run.status === "failed" || run.status === "blocked").slice(0, 5);
  const failedRecordings = recordings.filter(item => item.trigger && item.startedAt >= localDay(from).getTime() && item.startedAt < addDays(localDay(to), 1).getTime()).slice(0, 5);
  const card = (type: "web" | "api") => {
    const items = runs.filter(run => run.type === type);
    const passed = count(items, "passed"), failed = count(items, "failed"), cancelled = count(items, "cancelled"), blocked = count(items, "blocked");
    const rate = passed + failed ? Math.round(passed / (passed + failed) * 100) : null;
    const durations = items.filter(run => run.status === "passed" || run.status === "failed").map(shortDuration).sort((a, b) => a - b);
    const mid = Math.floor(durations.length / 2);
    const median = durations.length ? Math.round(durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2) : null;
    const filter = (next: Status) => { setKind(type); setStatus(next); setPage(1); };
    return <section className="dash-kpi" key={type} aria-label={type === "web" ? "웹 시나리오 통계" : "API 테스트 통계"}>
      <div className="dash-kpi-title"><span><Icon name={type === "web" ? "dynamic_form" : "data_object"} size={16} /></span><strong>{type === "web" ? "웹 시나리오" : "API 테스트"}</strong><small>{type === "web" ? "실행 묶음 기준" : "시나리오 실행 기준"}</small></div>
      <div className="dash-kpi-rate"><span>실행 성공률</span><div><strong>{rate === null ? "—" : `${rate}%`}</strong><small>성공 {passed} / 완료 {passed + failed}건</small></div><div className="dash-progress"><i style={{ width: `${rate ?? 0}%` }} /></div></div>
      <div className="dash-kpi-bottom"><Button onClick={() => filter("failed")}><span>실패한 실행</span><strong className={failed ? "is-failed" : ""}>{failed}<small>건</small></strong></Button>{type === "api" ? <Button onClick={() => filter("blocked")}><span>설정 필요</span><strong>{blocked}<small>건</small></strong></Button> : <Button onClick={() => filter("cancelled")}><span>취소한 실행</span><strong>{cancelled}<small>건</small></strong></Button>}{type === "api" ? <Button onClick={() => filter("cancelled")}><span>취소</span><strong>{cancelled}<small>건</small></strong></Button> : <div><span>실행 소요 시간</span><strong>{median === null ? "—" : formatClock(median)}</strong></div>}</div>
    </section>;
  };
  return <div className="dash-v3">
    <div className="dash-v3-brand" aria-hidden="true"><img src={checklyMark} alt="" /></div>
    <div className="dash-v3-inner">
      <header className="dash-v3-header"><div><div className="dash-v3-heading"><h1>대시보드</h1>{projectCode && <span>{projectCode}</span>}</div><p>{from} 00:00 ~ {to} 23:59</p></div><div className="dash-v3-actions"><Button onClick={() => setRevision(value => value + 1)} disabled={!projectId || loading}>↻ {loading ? "갱신 중" : updated ? `${updated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트` : "새로고침"}</Button><select aria-label="조회 기간" value={period} onChange={event => choosePeriod(event.target.value)}><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="custom">직접 선택</option></select></div></header>
      {period === "custom" && <div className="dash-custom"><Input type="date" aria-label="시작 날짜" value={from} onChange={event => { setFrom(event.target.value); setWeek(0); setPage(1); setSelectedDay(""); }} /><span>~</span><Input type="date" aria-label="종료 날짜" value={to} onChange={event => { setTo(event.target.value); setWeek(0); setPage(1); setSelectedDay(""); }} />{!valid && <span>기간은 시작일부터 최대 366일로 선택해 주세요.</span>}</div>}
      <div className="dash-v3-tabs" role="tablist" aria-label="테스트 유형">{([['all', '전체'], ['web', '웹 시나리오'], ['api', 'API 테스트']] as const).map(([value, label]) => <Button key={value} role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setPage(1); }}>{label}</Button>)}</div>
      {!projectId ? <div className="dash-state"><strong>로그인이 필요합니다</strong><p>팀 프로젝트에 로그인하면 실행 기록을 확인할 수 있습니다.</p></div> : !valid ? null : error ? <div className="dash-state" role="alert"><strong>실행 기록을 불러오지 못했습니다</strong><p>{error}</p><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>다시 시도</Button></div> : loading ? <div className="dash-state" role="status">실행 기록을 불러오는 중입니다.</div> : <>
        <div className="dash-layout">
        <div className="dash-main">
        <p className="dash-summary">{period === "custom" ? "선택한 기간" : `최근 ${period}일`} 동안 {kind !== "api" && <>웹 <b>{runs.filter(run => run.type === "web").length}</b>회</>}{kind === "all" && ", "}{kind !== "web" && <>API <b>{runs.filter(run => run.type === "api").length}</b>회</>} 실행했어요.</p>
        <div className="dash-kpis">{kind !== "api" && card("web")}{kind !== "web" && card("api")}</div>
        <section className="dash-panel dash-days"><div className="dash-panel-heading"><h2>날짜별 실행</h2><div className="dash-legend">{(["passed", "failed", "blocked", "cancelled"] as Status[]).map(item => <span key={item}><i className={item} />{labels[item]}</span>)}</div></div>
          {totalWeeks > 1 && <div className="dash-week"><Button onClick={() => setWeek(safeWeek + 1)} disabled={safeWeek >= totalWeeks - 1} aria-label="이전 주">‹</Button><strong>{days.length ? `${dateLabel(days[0])} ~ ${dateLabel(days[days.length - 1])}` : ""}</strong><Button onClick={() => setWeek(safeWeek - 1)} disabled={safeWeek === 0} aria-label="다음 주">›</Button><span>{totalWeeks - safeWeek} / {totalWeeks}주</span><div className="dash-heat" aria-label="전체 기간">{sortedDays.map((day, index) => { const key = dayKey(day), daily = selectedRuns.filter(run => dayKey(new Date(run.startedAt)) === key); const color = daily.some(run => run.status === "failed") ? "failed" : daily.some(run => run.status === "blocked") ? "blocked" : daily.length ? "passed" : "empty"; return <Button key={key} className={color} aria-label={`${key} ${daily.length}건`} aria-pressed={selectedDay === key} onClick={() => { setWeek(Math.floor((sortedDays.length - 1 - index) / 7)); setSelectedDay(key); setPage(1); }} />; })}</div></div>}
          <div className="dash-day-grid">{days.map(day => { const key = dayKey(day), daily = selectedRuns.filter(run => dayKey(new Date(run.startedAt)) === key), bad = daily.filter(run => run.status === "failed" || run.status === "blocked").length; return <Button key={key} className={`dash-day${selectedDay === key ? " selected" : ""}${bad ? " bad" : ""}`} onClick={() => { setSelectedDay(selectedDay === key ? "" : key); setPage(1); }} aria-pressed={selectedDay === key}><span><b>{dateLabel(day)}</b> {key === today ? "오늘" : day.toLocaleDateString("ko-KR", { weekday: "short" })}<strong>{daily.length}</strong></span><span className="dash-day-dots">{daily.slice(0, 28).map(run => <i key={`${run.type}-${run.id}`} className={run.status} title={`${run.name} · ${labels[run.status]}`} />)}</span>{bad > 0 && <em>문제 {bad}건</em>}</Button>; })}</div>
        </section>
        <section className="dash-panel dash-history"><div className="dash-panel-heading dash-filters"><h2>최근 실행</h2><select aria-label="상태" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">상태 전체</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="환경" value={environment} onChange={event => { setEnvironment(event.target.value); setPage(1); }}><option value="all">환경 전체</option>{environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="none">환경 정보 없음</option></select><Input type="search" aria-label="실행명 검색" placeholder="실행명 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
          {(status !== "all" || environment !== "all" || search || selectedDay) && <div className="dash-applied">적용 중 {selectedDay && <span>{selectedDay}</span>}{status !== "all" && <span>{labels[status as Status]}</span>}{environment !== "all" && <span>{environment === "none" ? "환경 정보 없음" : envName(environment)}</span>}{search && <span>{search}</span>}<Button onClick={resetFilters}>모두 해제</Button></div>}
          <div className="dash-table-wrap"><div className="dash-table-head"><span>상태</span><span>유형</span><span>실행명</span><span>결과</span><span>환경</span><span>소요 시간</span><span>시작 시각 ↓</span></div>{filtered.slice((currentPage - 1) * perPage, currentPage * perPage).map(run => <Button className="dash-row" key={`${run.type}-${run.id}`} onClick={() => void open(run)}><span><i className={`dash-badge ${run.status}`}>{labels[run.status]}</i></span><span>{run.type === "web" ? "웹" : "API"}</span><strong>{run.name}</strong><span>{run.type === "web" ? `성공 ${run.passed} · 실패 ${run.failed}` : labels[run.status]}</span><span>{envName(run.environmentId)}</span><span>{formatClock(shortDuration(run))}</span><span>{new Date(run.startedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></Button>)}</div>
          {!filtered.length && <div className="dash-empty"><strong>{runs.length ? "조건에 맞는 실행이 없어요" : "선택한 기간에 실행 기록이 없습니다"}</strong><p>시나리오를 실행하면 결과를 여기서 확인할 수 있어요.</p>{runs.length ? <Button variant="secondary" onClick={resetFilters}>필터 모두 해제</Button> : <><Button variant="secondary" onClick={onOpenRun}>웹 실행 열기</Button> <Button variant="secondary" onClick={onOpenApi}>API 테스트 열기</Button></>}</div>}
          {filtered.length > 0 && <div className="dash-pager"><select aria-label="한 페이지에 보일 개수" value={perPage} onChange={event => { setPerPage(Number(event.target.value)); setPage(1); }}>{[10, 20, 50].map(n => <option key={n} value={n}>{n}개씩 보기</option>)}</select><div><Button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="이전 페이지">‹</Button><span>{currentPage} / {pageCount}</span><Button onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="다음 페이지">›</Button></div><span>총 {filtered.length}건</span></div>}
        </section>
        </div>
        <aside className="dash-side" aria-label="확인 필요와 소식">
        <section className="dash-panel dash-attention"><div className="dash-panel-heading"><h2>확인 필요</h2><small>선택 기간 내 최근 실패·설정 필요 실행</small></div>{attention.length ? attention.map(run => <Button className="dash-alert" key={`${run.type}-${run.id}`} onClick={() => void open(run)}><i className={`dash-badge ${run.status}`}>{labels[run.status]}</i><strong>{run.name}</strong><span>{run.type === "web" ? "웹" : "API"} · {envName(run.environmentId)}</span></Button>) : <p>선택한 기간에 실패하거나 설정이 필요한 실행이 없어요.</p>}
          {kind !== "api" && <div className="dash-recordings"><strong>서버 브라우저 오류 기록</strong><small>서버에 저장된 최근 200개 중 선택 기간의 기록</small>{recordingError ? <p role="status">{recordingError}</p> : failedRecordings.length ? failedRecordings.map(item => <Button className="dash-alert" key={item.id} onClick={() => onOpenRecording(item.id)}><i className="dash-badge failed">오류 기록</i><strong>{item.title || "브라우저 테스트"}</strong><span>{new Date(item.startedAt).toLocaleString("ko-KR")}</span></Button>) : <p>선택한 기간의 서버 오류 기록이 없어요.</p>}</div>}
        </section>
        <section className="dash-news" aria-label="Checkly 소식"><div className="dash-news-heading"><span className="dash-news-logo"><img src={checklyMark} alt="" /></span><div><strong>Checkly Recorder</strong><p>브라우저 오류를 바로 팀에 넘겨요</p></div></div><a href={RECORDER_STORE_URL} target="_blank" rel="noreferrer">바로가기 ↗</a></section>
        </aside>
        </div>
      </>}
    </div>
    {apiDetail && <Modal label="API 실행 상세" backdropClassName="dash-detail-backdrop" className="dash-detail" onClose={() => setApiDetail(null)}>
      <div className="dash-panel-heading"><h2>API 실행 상세</h2><Button variant="ghost" iconOnly aria-label="닫기" onClick={() => setApiDetail(null)}>✕</Button></div>
      <h3>{apiDetail.name}</h3><p><i className={`dash-badge ${apiDetail.status}`}>{labels[apiDetail.status]}</i></p>
      <dl><dt>환경</dt><dd>{envName(apiDetail.environmentId)}</dd><dt>시작 시각</dt><dd>{new Date(apiDetail.startedAt).toLocaleString("ko-KR")}</dd><dt>소요 시간</dt><dd>{formatClock(shortDuration(apiDetail))}</dd></dl>
      <p className="dash-detail-note">팀에는 실행 요약만 저장됩니다. 요청과 응답은 이 기록에서 복원할 수 없습니다.</p>
      <Button variant="secondary" onClick={() => { setApiDetail(null); onOpenApi(); }}>API 테스트 열기</Button>
    </Modal>}
  </div>;
};
