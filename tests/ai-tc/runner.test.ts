import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AiTcRunner, stableSessionTimer } from "../../src/app/ipc/ai-tc/runner";
import type { AiTcRunPlan, AiTcRunState } from "../../src/app/ipc/ai-tc/model";
import { recordingKey } from "../../src/app/ipc/ai-tc/recording";

// 테스트 전용 페이지에서 실제 headless Chromium을 조작한다. 모델은 정해진 답을 차례로 돌려주는 가짜다.
const page = `<!doctype html><html><head><title>카테고리 등록</title></head><body>
<label>카테고리명 <input id="name" /></label><span id="count">0/30</span>
<label>설명 <input id="description" /></label>
<label>비밀번호 <input type="password" /></label>
<button onclick="document.getElementById('done').textContent='등록 완료'">등록</button>
<p id="done"></p><a id="out" href="OUT">외부 사이트</a>
<script>document.getElementById('name').addEventListener('input', e => document.getElementById('count').textContent = e.target.value.length + '/30')</script>
</body></html>`;

let server: Server;
let origin = "";
let other = "";
let dir = "";
let changedCounter = false;
let changedButton = false;
let delayedCounter = false;
let freezeCounter = false;
let navigateDuringAi = false;
let duplicateText = false;
let disabledButton = false;
let changeDuringAi = false;
let changeInputDuringAi = false;
let continuousChanges = false;
let sessionTimer = false;
let transientAlert = false;
before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    let body = changedCounter ? page.replace("e.target.value.length + '/30'", "e.target.value.length + '/40'") : page;
    if (freezeCounter) body = body.replace("document.getElementById('count').textContent = e.target.value.length + '/30'", "void 0");
    if (delayedCounter) body = body.replace("document.getElementById('count').textContent = e.target.value.length + '/30'", "setTimeout(() => document.getElementById('count').textContent = e.target.value.length + '/30', 800)");
    if (changedButton) body = body.replace(">등록</button>", ">저장</button>");
    if (disabledButton) body = body.replace('<button onclick=', '<button disabled onclick=');
    if (navigateDuringAi) body += '<script>setTimeout(() => location.href="/changed", 800)</script>';
    if (changeDuringAi) body += '<script>setTimeout(() => document.querySelector("#done").textContent="화면 변경", 800)</script>';
    if (changeInputDuringAi) body += '<script>setTimeout(() => document.querySelector("#name").value="외부 변경", 800)</script>';
    if (continuousChanges) body += '<script>setInterval(() => document.querySelector("#done").textContent=String(Date.now()), 50)</script>';
    if (sessionTimer) body += '<button><span role="img" aria-label="clock-circle"></span><span id="timer">남은 시간 58:59</span></button><script>let seconds=59; setInterval(() => document.querySelector("#timer").textContent="남은 시간 58:"+String(--seconds).padStart(2,"0"), 100)</script>';
    if (transientAlert) body = body.replace("document.getElementById('done').textContent='등록 완료'", "document.getElementById('done').innerHTML='<span role=&quot;alert&quot;>등록 성공 알림</span>';setTimeout(() => document.getElementById('done').textContent='', 100)");
    if (duplicateText) body += '<p>0/30</p>';
    response.end(request.url === "/" ? body.replace("OUT", `${other}/x`) : "<html><body><h1>외부</h1></body></html>");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  origin = `http://127.0.0.1:${port}`;
  other = `http://localhost:${port}`;
  dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-tc-"));
});
const runners: AiTcRunner[] = [];
after(async () => { await Promise.all(runners.map(runner => runner.shutdown())); server.close(); await rm(dir, { recursive: true, force: true }); });

const plan = (cases: Array<Partial<AiTcRunPlan["cases"][number]> & { id: string }>): AiTcRunPlan => ({
  cases: cases.map((item, index) => ({
    key: `QA.xlsx:BOS_TC:${index + 4}`, title: item.id, pre: "", steps: ["카테고리명 입력", "[등록] 클릭"],
    expected: [{ id: "E1", text: "글자 수가 표시된다" }, { id: "E2", text: "등록 완료가 표시된다" }], data: [], files: [], after: [], readyRefs: [], ...item,
  })),
  startUrl: origin, allowedHosts: [new URL(origin).host], capture: true, video: false, tool: "claude", environmentLabel: "test",
});

function harness(replies: Array<object | "hang">, usage?: { input: number; output: number; cachedInput?: number; cacheWrite?: number }, toolAvailable = true, onState?: (state: AiTcRunState, runner: AiTcRunner) => void, delayMs = 0) {
  const states: AiTcRunState[] = [];
  const prompts: string[] = [];
  const screenshots: Array<string | undefined> = [];
  let resolveHang: ((text: string) => void) | undefined;
  let lateUsage: (() => void) | undefined;
  const listeners: Array<() => void> = [];
  const runner = new AiTcRunner({
    emit: state => { states.push(state); onState?.(state, runner); listeners.splice(0).forEach(listener => listener()); },
    preview: () => undefined,
    dataDir: dir,
    toolPath: async () => toolAvailable ? "/fake/claude" : undefined,
    resolveFile: () => undefined,
    headless: true,
    ask: input => {
      prompts.push(input.prompt);
      screenshots.push(input.screenshot);
      const next = replies.shift();
      if (next === "hang" || !next) { lateUsage = () => input.onUsage?.({ input: 10, output: 2, cachedInput: 0, cacheWrite: 0 }); return { promise: new Promise<string>(resolve => { resolveHang = resolve; }), cancel: () => undefined }; }
      return { promise: new Promise<string>(resolve => setTimeout(() => { input.onUsage?.(usage); resolve(JSON.stringify(next)); }, delayMs)), cancel: () => undefined };
    },
  });
  runners.push(runner);
  const until = async (predicate: (state: AiTcRunState) => boolean, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const last = states[states.length - 1];
      if (last && predicate(last)) return last;
      if (Date.now() > deadline) throw new Error(`시간 초과: ${JSON.stringify(last?.status)} ${JSON.stringify(last?.wait)}`);
      await new Promise<void>(resolve => { listeners.push(resolve); setTimeout(resolve, 200); });
    }
  };
  return { runner, states, prompts, screenshots, until, lateReply: (text: string) => resolveHang?.(text), lateUsage: () => lateUsage?.() };
}

test("짧게 나타난 알림을 다음 판정에 전달한다", async () => {
  transientAlert = true;
  try {
    const h = harness([
      { action: { type: "click", target: { role: "button", name: "등록" }, expected: "E1" } },
      { action: { type: "judge", expected: "E1", verdict: "pass", observation: "등록 성공 알림", basis: [{ k: "알림", v: "등록 성공 알림" }] } },
    ], undefined, true, undefined, 350);
    await h.runner.start(plan([{ id: "toast", expected: [{ id: "E1", text: "성공 알림 표시" }] }]));
    const done = await h.until(state => state.status === "done");
    assert.match(h.prompts[1]!, /직전 동작 이후 포착한 일시적 알림[\s\S]*등록 성공 알림/);
    assert.equal(done.cases[0]!.expected[0]!.verdict, "pass");
  } finally { transientAlert = false; }
});

test("입력·관찰 후 판정하고 데이터 변경 클릭을 확인 없이 실행한다", async () => {
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "가나다", expected: "E1" } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "카운터 3/30", basis: [{ k: "텍스트", v: "3/30" }], assertion: { type: "visibleText", text: "3/30" } } },
    { action: { type: "click", target: { role: "button", name: "등록" }, expected: "E2" } },
    { action: { type: "judge", expected: "E2", verdict: "pass", observation: "등록 완료 표시", basis: [{ k: "텍스트", v: "등록 완료" }], assertion: { type: "visibleText", text: "등록 완료" } } },
  ]);
  const started = await h.runner.start({ ...plan([{ id: "SC-01-TC04", data: [{ label: "이름", value: "가나다" }] }]), imageToAi: false });
  const done = await h.until(state => state.status === "done");
  assert.match(h.prompts[1]!, /3\/30/, "입력 결과를 다시 관찰해 모델에 보낸다");
  assert.ok(h.screenshots.every(image => image === undefined), "이미지 전송을 끄면 AI에 전달하지 않는다");
  assert.deepEqual(done.cases[0]!.expected.map(item => item.verdict), ["pass", "pass"]);
  assert.ok(done.cases[0]!.timing && done.cases[0]!.timing.browserMs > 0, "브라우저 실행 시간을 기록한다");
  const reviewed = await h.runner.approveAssertion({ runId: started.runId, caseKey: done.cases[0]!.key, expectedId: "E1", approved: true });
  assert.ok(reviewed?.cases[0]!.recording?.some(step => step.type === "verify" && step.expected === "E1" && step.approved));
  assert.equal(reviewed?.cases[0]!.expected[0]!.verdict, "pass");
  assert.ok(done.cases[0]!.expected[1]!.captureId, "판정마다 근거 캡처를 남긴다");
  assert.ok(done.cases[0]!.actions.some(action => action.op === "클릭" && action.result === "완료"));
  assert.ok(!h.states.some(state => state.wait?.kind === "confirm"));
  assert.ok(await h.runner.capture(started.runId, done.cases[0]!.expected[1]!.captureId));
  await h.runner.approveAssertion({ runId: started.runId, caseKey: done.cases[0]!.key, expectedId: "E2", approved: true });
  const restoredRunner = harness([], undefined, false);
  const needs = await restoredRunner.runner.savedNeeds({ ...plan([{ id: "SC-01-TC04" }]), imageToAi: false });
  assert.deepEqual(needs[0]!.labels, ["이름"]);
  await assert.rejects(restoredRunner.runner.startSavedReplay({ ...plan([{ id: "SC-01-TC04" }]), imageToAi: false }), /데이터 항목 "이름"/);
  const restoredRun = await restoredRunner.runner.startSavedReplay({ ...plan([{ id: "SC-01-TC04", data: [{ label: "이름", value: "다른 값" }] }]), imageToAi: false });
  const restoredResult = await restoredRunner.until(state => state.runId === restoredRun.runId && state.status === "done");
  assert.equal(restoredResult.budget.modelCalls, 0);
  assert.equal(restoredResult.cases[0]!.expected[0]!.verdict, "fail", "새 입력 데이터로 다시 검증한다");
  delayedCounter = true;
  const replay = await h.runner.startReplay(started.runId);
  const replayed = await h.until(state => state.runId === replay.runId && state.status === "done");
  delayedCounter = false;
  assert.equal(replayed.budget.modelCalls, 0);
  assert.equal(replayed.previousRun?.modelCalls, 4);
  assert.deepEqual(replayed.cases[0]!.expected.map(item => item.verdict), ["pass", "pass"]);
  assert.equal(replayed.cases[0]!.expected[0]!.by, "automation");
  await h.runner.review({ runId: replay.runId, caseKey: replayed.cases[0]!.key, expectedId: "E1", verdict: "check", note: "확인" });
  const restored = await h.runner.review({ runId: replay.runId, caseKey: replayed.cases[0]!.key, expectedId: "E1", verdict: null, note: "" });
  assert.equal(restored?.cases[0]!.expected[0]!.by, "automation");
  changedCounter = true;
  try {
    const changed = await h.runner.startReplay(replay.runId);
    const failed = await h.until(state => state.runId === changed.runId && state.status === "done");
    assert.deepEqual(failed.cases[0]!.expected.map(item => item.verdict), ["fail", "check"]);
    assert.equal(failed.budget.modelCalls, 0);
    assert.ok(!failed.cases[0]!.actions.some(action => action.op === "클릭"), "앞선 검증 실패 후 등록하지 않는다");
  } finally { changedCounter = false; }
  const originalAgain = await h.runner.startSavedReplay({ ...plan([{ id: "SC-01-TC04", data: [{ label: "이름", value: "가나다" }] }]), imageToAi: false });
  const originalResult = await h.until(state => state.runId === originalAgain.runId && state.status === "done");
  assert.deepEqual(originalResult.cases[0]!.expected.map(item => item.verdict), ["pass", "pass"], "실패한 재실행은 승인된 절차를 덮어쓰지 않는다");
});

test("허용 도메인 밖으로 이동하면 멈추고, Blocked로 기록할 수 있다", async () => {
  const h = harness([{ action: { type: "click", target: { role: "link", name: "외부 사이트" }, expected: "E1" } }]);
  const started = await h.runner.start(plan([{ id: "SC-11-TC01" }]));
  const waiting = await h.until(state => state.status === "waiting");
  assert.equal(waiting.wait?.kind, "domain");
  assert.equal(waiting.outOfDomain, true);
  h.runner.decide(started.runId, "block");
  const done = await h.until(state => state.status === "done");
  assert.deepEqual(done.cases[0]!.expected.map(item => item.verdict), ["blocked", "blocked"]);
  assert.match(done.cases[0]!.reason!, /허용 도메인/);
});

test("선행 TC가 Pass가 아니면 후속 TC는 실행하지 않고 Blocked", async () => {
  const h = harness([
    { action: { type: "judge", expected: "E1", verdict: "fail", observation: "카운터 없음", basis: [] } },
    { action: { type: "judge", expected: "E2", verdict: "pass", observation: "확인", basis: [] } },
  ]);
  await h.runner.start(plan([{ id: "A-TC01" }, { id: "A-TC02", after: ["A-TC01"] }]));
  const done = await h.until(state => state.status === "done");
  assert.deepEqual(done.cases[1]!.expected.map(item => item.verdict), ["blocked", "blocked"]);
  assert.match(done.cases[1]!.reason!, /선행 TC A-TC01 Fail/);
  assert.equal(h.prompts.length, 2, "Blocked TC에는 모델을 부르지 않는다");
});

test("취소하면 진행 중 항목은 미실행이고 늦게 온 모델 응답은 무시한다", async () => {
  const h = harness(["hang"]);
  const started = await h.runner.start(plan([{ id: "A-TC01" }, { id: "A-TC02" }]));
  await h.until(state => state.budget.modelCalls === 1);
  await h.runner.cancel(started.runId);
  await h.runner.cancel(started.runId);
  const cancelled = await h.until(state => state.status === "cancelled");
  h.lateUsage();
  h.lateReply(JSON.stringify({ action: { type: "judge", expected: "E1", verdict: "pass", observation: "늦은 응답", basis: [] } }));
  await new Promise(resolve => setTimeout(resolve, 300));
  const last = h.states[h.states.length - 1]!;
  assert.equal(last.status, "cancelled");
  assert.deepEqual(cancelled.cases.flatMap(item => item.expected.map(expected => expected.verdict)), ["pending", "pending", "pending", "pending"]);
  assert.equal(h.runner.current()!.cases[0]!.expected[0]!.observation, "취소로 미실행");
  assert.equal(h.runner.current()!.usage?.unknown, 1);
  assert.equal(h.runner.current()!.usage?.input, 0);
});

test("동시에 시작 요청을 보내면 하나만 실행된다", async () => {
  const h = harness(["hang"]);
  const [first, second] = await Promise.allSettled([h.runner.start(plan([{ id: "RACE-1" }])), h.runner.start(plan([{ id: "RACE-2" }]))]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  if (first.status === "fulfilled") await h.runner.cancel(first.value.runId);
});


test("녹화 영상은 실행 종료 후 사용할 수 있고 폐기하면 삭제된다", async () => {
  const h = harness([
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [] } },
    { action: { type: "judge", expected: "E2", verdict: "pass", observation: "확인", basis: [] } },
  ]);
  const started = await h.runner.start({ ...plan([{ id: "VIDEO-TC01" }]), video: true });
  await h.until(state => state.status === "done");
  const file = await h.runner.videoPath(started.runId);
  assert.ok(file);
  assert.ok((await stat(file)).size > 0);
  await h.runner.discardVideo(started.runId);
  await assert.rejects(stat(file));
});

test("인계 중 같은 페이지를 직접 조작하고 답변과 변경된 화면을 재관찰한다", async () => {
  const h = harness([
    { action: { type: "handoff", reason: "기존 이름을 확인해 알려주세요" } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [{ k: "입력", v: "3/30" }] } },
    { action: { type: "done" } },
  ]);
  const started = await h.runner.start(plan([{ id: "SC-HANDOFF" }]));
  await h.until(state => state.wait?.kind === "handoff");
  await h.runner.browserEvent(started.runId, { type: "click", x: 100, y: 18 });
  await h.runner.browserEvent(started.runId, { type: "text", text: "abc" });
  await new Promise(resolve => setTimeout(resolve, 50));
  h.runner.decide(started.runId, "resume", "기존 이름은 ABC입니다");
  const done = await h.until(state => state.status === "done");
  assert.ok((done.userWaitMs ?? 0) >= 50, "사용자 대기를 실행 전체에 기록한다");
  assert.match(h.prompts[1]!, /기존 이름은 ABC입니다/);
  assert.match(h.prompts[1]!, /3\/30/);
  assert.ok(done.cases[0]!.recording?.some(step => step.type === "manual"));
  await assert.rejects(h.runner.startReplay(started.runId), /수동 동작/);
});

test("로그인 대기 상태가 전달되는 즉시 재개해도 다음 동작을 진행한다", async () => {
  const h = harness([
    { action: { type: "handoff", reason: "로그인", login: true } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [] } },
    { action: { type: "done" } },
  ], undefined, true, (state, runner) => {
    if (state.wait?.kind === "login") runner.decide(state.runId, "resume");
  });
  await h.runner.start(plan([{ id: "SC-LOGIN" }]));
  const done = await h.until(state => state.status === "done");
  assert.equal(done.cases[0]!.expected[0]!.verdict, "pass");
  assert.ok(h.prompts.length >= 2);
});

test("실패한 동작을 우회해 성공했어도 빠른 재실행에서 누락하지 않는다", async () => {
  const h = harness([
    { action: { type: "click", target: { role: "button", name: "없는 버튼" } } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값", basis: [], assertion: { type: "visibleText", text: "0/30" } } },
  ]);
  const started = await h.runner.start(plan([{ id: "SC-RETRY", expected: [{ id: "E1", text: "초기 글자 수" }] }]));
  const done = await h.until(state => state.status === "done");
  await h.runner.approveAssertion({ runId: started.runId, caseKey: done.cases[0]!.key, expectedId: "E1", approved: true });
  await assert.rejects(h.runner.startReplay(started.runId), /수동 동작/);
});

test("토큰 한도 도달 후 추가 모델 호출을 하지 않는다", async () => {
  const h = harness([{ action: { type: "fill", target: { label: "카테고리명" }, value: "abc" } }], { input: 10, output: 2, cachedInput: 0, cacheWrite: 0 });
  await h.runner.start({ ...plan([{ id: "LIMIT" }]), tokenLimit: 10 });
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 1);
  assert.equal(done.usage?.input, 10);
  assert.equal(done.cases[0]!.usage?.input, 10);
  assert.match(done.cases[0]!.expected[0]!.observation, /토큰 예산/);
});

test("응답 형식 오류로 다시 호출한 사용량도 전체와 TC에 합산한다", async () => {
  const h = harness([{ invalid: true }, { action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [] } }], { input: 10, output: 2, cachedInput: 3, cacheWrite: 4 });
  await h.runner.start(plan([{ id: "USAGE-RETRY", expected: [{ id: "E1", text: "확인" }] }]));
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 2);
  for (const usage of [done.usage, done.cases[0]!.usage]) assert.deepEqual(usage, { input: 20, output: 4, cachedInput: 6, cacheWrite: 8, measured: 2, unknown: 0 });
  assert.deepEqual(done.usageByPhase?.retry, { input: 10, output: 2, cachedInput: 3, cacheWrite: 4, measured: 1, unknown: 0 });
  assert.deepEqual(done.usageByPhase?.judge, { input: 10, output: 2, cachedInput: 3, cacheWrite: 4, measured: 1, unknown: 0 });
});

test("TC별 토큰 한도는 해당 TC만 중단하고 다음 TC를 실행한다", async () => {
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "abc" } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [] } },
  ], { input: 10, output: 2, cachedInput: 0, cacheWrite: 0 });
  await h.runner.start({ ...plan([{ id: "LIMIT-1", expected: [{ id: "E1", text: "입력" }] }, { id: "LIMIT-2", expected: [{ id: "E1", text: "확인" }] }]), tokenLimitPerCase: 10 });
  const done = await h.until(state => state.status === "done");
  assert.deepEqual(done.cases.map(item => item.expected[0]!.verdict), ["check", "pass"]);
  assert.match(done.cases[0]!.expected[0]!.observation, /이 TC의 토큰 예산/);
  assert.ok(h.states.some(state => state.budget.tokenWarning?.includes("현재 TC")));
});

test("같은 화면의 준비된 입력을 묶어도 각 동작은 별도로 검증하고 기록한다", async () => {
  freezeCounter = true;
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "abc" }, nextFills: [{ type: "fill", target: { label: "설명" }, value: "설명값" }] },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "입력 확인", basis: [] } },
  ]);
  await h.runner.start(plan([{ id: "BATCH", expected: [{ id: "E1", text: "입력됨" }], data: [{ label: "이름", value: "abc" }, { label: "설명", value: "설명값" }] }]));
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 2);
  assert.equal(done.cases[0]!.actions.filter(item => item.op === "입력" && item.result === "완료").length, 2);
  assert.equal(done.cases[0]!.recording?.filter(item => item.type === "fill").length, 2);
  freezeCounter = false;
});

test("묶인 입력의 대상이 처음부터 없으면 나머지를 버리고 AI가 재관찰한다", async () => {
  freezeCounter = true;
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "abc" }, nextFills: [{ type: "fill", target: { label: "없는 항목" }, value: "x" }, { type: "fill", target: { label: "설명" }, value: "y" }] },
    { action: { type: "judge", expected: "E1", verdict: "check", observation: "대상 없음", basis: [] } },
  ]);
  await h.runner.start(plan([{ id: "BATCH-FAIL", expected: [{ id: "E1", text: "입력됨" }], data: [{ label: "a", value: "abc" }, { label: "b", value: "x" }, { label: "c", value: "y" }] }]));
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 2);
  assert.ok(!done.cases[0]!.actions.some(item => item.op === "입력" && item.target.includes("설명")));
  assert.match(h.prompts[1]!, /지금까지 동작/);
  freezeCounter = false;
});

test("묶인 입력 뒤 안내 문구가 바뀌면 나머지는 실행하지 않는다", async () => {
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "abc" }, nextFills: [{ type: "fill", target: { label: "설명" }, value: "y" }] },
    { action: { type: "judge", expected: "E1", verdict: "check", observation: "화면 변화", basis: [] } },
  ]);
  await h.runner.start(plan([{ id: "BATCH-CHANGE", expected: [{ id: "E1", text: "입력됨" }], data: [{ label: "a", value: "abc" }, { label: "b", value: "y" }] }]));
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 2);
  assert.ok(!done.cases[0]!.actions.some(item => item.op === "입력" && item.target.includes("설명")));
  assert.match(h.prompts[1]!, /3\/30/);
});

test("AI가 비밀번호 입력을 요청하면 앱이 거부한다", async () => {
  const h = harness([
    { action: { type: "fill", target: { label: "비밀번호" }, value: "secret" } },
    { action: { type: "judge", expected: "E1", verdict: "check", observation: "직접 입력 필요", basis: [] } },
  ]);
  await h.runner.start(plan([{ id: "PASSWORD", expected: [{ id: "E1", text: "로그인" }] }]));
  const done = await h.until(state => state.status === "done");
  assert.ok(done.cases[0]!.actions.some(item => item.op === "입력" && item.result === "비밀번호 입력 거부"));
  assert.ok(!JSON.stringify(done.cases[0]!.recording).includes("secret"));
});

test("Claude 캐시 사용량이 누락되면 토큰 예산 실행을 중단한다", async () => {
  const h = harness([{ action: { type: "fill", target: { label: "카테고리명" }, value: "abc" } }], { input: 1, output: 1 });
  await h.runner.start({ ...plan([{ id: "UNKNOWN" }]), tokenLimit: 10000 });
  const done = await h.until(state => state.status === "done");
  assert.equal(done.budget.modelCalls, 1);
  assert.match(done.cases[0]!.expected[0]!.observation, /사용량을 확인할 수 없어/);
});

test("AI 보조 재실행은 미승인 기대 결과만 현재 화면으로 판정한다", async () => {
  const judge = { action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값 확인", basis: [{ k: "텍스트", v: "0/30" }] } };
  const h = harness([judge, judge]);
  const original = await h.runner.start(plan([{ id: "ASSIST", expected: [{ id: "E1", text: "초기 글자 수" }] }]));
  await h.until(state => state.runId === original.runId && state.status === "done");
  const replay = await h.runner.startReplay(original.runId, true);
  const done = await h.until(state => state.runId === replay.runId && state.status === "done");
  assert.equal(done.budget.modelCalls, 1);
  assert.equal(done.cases[0]!.expected[0]!.verdict, "pass");
  assert.equal(done.cases[0]!.expected[0]!.by, "ai");
});

test("AI 보조 판정 중 제안한 클릭은 실행하지 않는다", async () => {
  const h = harness([{ action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값", basis: [] } }, { action: { type: "click", target: { role: "button", name: "등록" } } }]);
  const original = await h.runner.start(plan([{ id: "ASSIST", expected: [{ id: "E1", text: "초기 글자 수" }] }]));
  await h.until(state => state.runId === original.runId && state.status === "done");
  const replay = await h.runner.startReplay(original.runId, true);
  const done = await h.until(state => state.runId === replay.runId && state.status === "done");
  assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
  assert.ok(!done.cases[0]!.actions.some(item => item.op === "클릭"));
});

test("AI 보조 판정 대기 중 주소가 바뀌면 이전 화면의 응답을 사용하지 않는다", async () => {
  const h = harness([{ action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값", basis: [] } }, "hang"]);
  const original = await h.runner.start(plan([{ id: "AI-NAV", expected: [{ id: "E1", text: "초기 값" }] }]));
  await h.until(state => state.runId === original.runId && state.status === "done");
  navigateDuringAi = true;
  try {
    const replay = await h.runner.startReplay(original.runId, true);
    await h.until(state => state.runId === replay.runId && state.budget.modelCalls === 1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    h.lateReply(JSON.stringify({ action: { type: "judge", expected: "E1", verdict: "pass", observation: "이전 화면", basis: [] } }));
    const done = await h.until(state => state.runId === replay.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.match(done.cases[0]!.expected[0]!.observation, /주소가 바뀌어/);
  } finally { navigateDuringAi = false; }
});

test("AI 보조 판정 중 같은 주소의 내용이 바뀌면 이전 판정을 버린다", async () => {
  const h = harness([{ action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값", basis: [] } }, "hang"]);
  const original = await h.runner.start(plan([{ id: "AI-ASSIST-DOM", expected: [{ id: "E1", text: "초기 값" }] }]));
  await h.until(state => state.runId === original.runId && state.status === "done");
  changeDuringAi = true;
  try {
    const replay = await h.runner.startReplay(original.runId, true);
    await h.until(state => state.runId === replay.runId && state.budget.modelCalls === 1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    h.lateReply(JSON.stringify({ action: { type: "judge", expected: "E1", verdict: "pass", observation: "이전 화면", basis: [] } }));
    const done = await h.until(state => state.runId === replay.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.match(done.cases[0]!.expected[0]!.observation, /화면 내용이 바뀌어/);
  } finally { changeDuringAi = false; }
});

test("AI 탐색 대기 중 주소가 바뀌면 이전 클릭을 버리고 재관찰한다", async () => {
  const h = harness(["hang", { action: { type: "judge", expected: "E1", verdict: "check", observation: "이동 확인", basis: [] } }]);
  navigateDuringAi = true;
  try {
    const run = await h.runner.start(plan([{ id: "AI-NAV-FIRST", expected: [{ id: "E1", text: "확인" }] }]));
    await h.until(state => state.runId === run.runId && state.budget.modelCalls === 1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    h.lateReply(JSON.stringify({ action: { type: "click", target: { role: "button", name: "등록" } } }));
    const done = await h.until(state => state.runId === run.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.ok(!done.cases[0]!.actions.some(item => item.op === "클릭"));
    assert.match(h.prompts[1]!, /이전 요청을 버렸다/);
  } finally { navigateDuringAi = false; }
});

test("같은 주소에서 AI 대기 중 화면 내용이 바뀌면 이전 요청을 버린다", async () => {
  const h = harness(["hang", { action: { type: "judge", expected: "E1", verdict: "check", observation: "변경 확인", basis: [] } }]);
  changeDuringAi = true;
  try {
    const run = await h.runner.start(plan([{ id: "AI-DOM-CHANGE", expected: [{ id: "E1", text: "확인" }] }]));
    await h.until(state => state.runId === run.runId && state.budget.modelCalls === 1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    h.lateReply(JSON.stringify({ action: { type: "click", target: { role: "button", name: "등록" } } }));
    const done = await h.until(state => state.runId === run.runId && state.status === "done");
    assert.ok(!done.cases[0]!.actions.some(item => item.op === "클릭"));
    assert.match(h.prompts[1]!, /화면 내용이 바뀌어/);
  } finally { changeDuringAi = false; }
});

test("세션 타이머 비교는 값만 제외하고 대상·만료·다른 변경은 보존한다", () => {
  const before = '- button "남은 시간 58:36"\n- button "등록"';
  const after = '- button "남은 시간 58:35"\n- button "등록"';
  assert.equal(stableSessionTimer(before, "프로모션 등록"), stableSessionTimer(after, "프로모션 등록"));
  assert.notEqual(stableSessionTimer(before, "남은 시간 확인"), stableSessionTimer(after, "남은 시간 확인"));
  assert.notEqual(stableSessionTimer(before, "등록", '{"name":"남은 시간 58:36"}'), stableSessionTimer(after, "등록", '{"name":"남은 시간 58:36"}'));
  assert.notEqual(stableSessionTimer('- button "남은 시간 00:01"', "등록"), stableSessionTimer('- button "남은 시간 00:00"', "등록"));
  assert.notEqual(stableSessionTimer(before, "등록"), stableSessionTimer(after.replace('"등록"', '"저장"'), "등록"));
  const antTimer = (value: string) => `- button "clock-circle남은 시간 ${value}":\n  - img "clock-circle"\n  - text: 남은 시간 ${value}\n- button "등록"`;
  assert.equal(stableSessionTimer(antTimer("58:36"), "등록"), stableSessionTimer(antTimer("58:35"), "등록"));
  const dateInput = JSON.stringify({ type: "fill", target: { placeholder: "시작일시" }, value: "2026-11-06 10:00" });
  assert.equal(stableSessionTimer(antTimer("58:36"), "운영 기간 입력", dateInput), stableSessionTimer(antTimer("58:35"), "운영 기간 입력", dateInput));
});

test("세션 타이머가 갱신돼도 다른 버튼을 클릭하고 결과를 판정한다", async () => {
  sessionTimer = true;
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "2026-11-06 10:00" } },
    { action: { type: "click", target: { role: "button", name: "등록" } } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "등록 완료", basis: [{ k: "화면", v: "등록 완료" }] } },
  ], undefined, true, undefined, 250);
  try {
    await h.runner.start(plan([{ id: "AI-TIMER", expected: [{ id: "E1", text: "등록 완료" }] }]));
    const done = await h.until(state => state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "pass");
    assert.ok(done.cases[0]!.actions.some(item => item.op === "클릭"));
    assert.match(h.prompts[1]!, /2026-11-06 10:00/);
    assert.match(h.prompts[0]!, /남은 시간 58:/);
    assert.ok(!h.states.some(state => state.wait?.kind === "handoff"));
  } finally { sessionTimer = false; }
});

test("화면 변경이 반복되면 모델 호출을 반복하지 않고 사용자에게 인계한다", async () => {
  continuousChanges = true;
  const reply = { action: { type: "click", target: { role: "button", name: "등록" } } };
  const h = harness([reply, reply, reply], undefined, true, undefined, 200);
  try {
    const run = await h.runner.start(plan([{ id: "AI-DYNAMIC", expected: [{ id: "E1", text: "확인" }] }]));
    const waiting = await h.until(state => state.wait?.kind === "handoff");
    assert.match(waiting.wait!.title, /계속 바뀌어/);
    assert.equal(waiting.budget.modelCalls, 3);
    assert.equal(waiting.cases[0]!.actions.filter(item => item.op === "관찰" && item.target === "AI 응답 중 화면 변경").length, 3);
    assert.ok(!waiting.cases[0]!.actions.some(item => item.op === "클릭"));
    h.runner.decide(run.runId, "block");
    assert.equal((await h.until(state => state.status === "done")).cases[0]!.expected[0]!.verdict, "blocked");
  } finally { continuousChanges = false; }
});

test("AI 대기 중 입력값이 바뀌면 이전 화면 기준 응답을 버린다", async () => {
  const h = harness(["hang", { action: { type: "judge", expected: "E1", verdict: "check", observation: "변경 확인", basis: [] } }]);
  changeInputDuringAi = true;
  try {
    const run = await h.runner.start(plan([{ id: "AI-INPUT-CHANGE", expected: [{ id: "E1", text: "확인" }] }]));
    await h.until(state => state.runId === run.runId && state.budget.modelCalls === 1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    h.lateReply(JSON.stringify({ action: { type: "click", target: { role: "button", name: "등록" } } }));
    const done = await h.until(state => state.runId === run.runId && state.status === "done");
    assert.ok(!done.cases[0]!.actions.some(item => item.op === "클릭"));
    assert.match(h.prompts[1]!, /외부 변경/);
  } finally { changeInputDuringAi = false; }
});

test("재실행 대상이 바뀌면 AI 수정 후보를 실행하지 않고 남긴다", async () => {
  const h = harness([
    { action: { type: "click", target: { role: "button", name: "등록" } } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "등록 완료", basis: [], assertion: { type: "visibleText", text: "등록 완료" } } },
    { action: { type: "click", target: { role: "button", name: "저장" } } },
  ]);
  const started = await h.runner.start(plan([{ id: "REPAIR", expected: [{ id: "E1", text: "등록 완료" }] }]));
  const original = await h.until(state => state.runId === started.runId && state.status === "done");
  await h.runner.approveAssertion({ runId: started.runId, caseKey: original.cases[0]!.key, expectedId: "E1", approved: true });
  changedButton = true;
  try {
    const replay = await h.runner.startReplay(started.runId, true);
    const done = await h.until(state => state.runId === replay.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.deepEqual(done.cases[0]!.repairSuggestion?.step, { type: "click", target: { role: "button", name: "저장" } });
    assert.ok(!done.cases[0]!.actions.some(item => item.op === "클릭" && item.result === "완료"));
    const patched = await h.runner.applyRepair({ runId: replay.runId, caseKey: done.cases[0]!.key });
    assert.equal(patched?.cases[0]!.repairSuggestion, undefined);
    const repaired = await h.runner.startReplay(replay.runId);
    const verified = await h.until(state => state.runId === repaired.runId && state.status === "done");
    assert.equal(verified.cases[0]!.expected[0]!.verdict, "pass");
    assert.equal(verified.budget.modelCalls, 0);
  } finally { changedButton = false; }
});

test("함께 실행한 TC 중 하나만 다시 선택해 저장된 절차를 사용한다", async () => {
  const judge = { action: { type: "judge", expected: "E1", verdict: "pass", observation: "초기 값", basis: [], assertion: { type: "visibleText", text: "0/30" } } };
  const h = harness([judge, judge]);
  const first = { id: "ONE", key: "QA.xlsx:BOS_TC:4", expected: [{ id: "E1", text: "초기 값" }] };
  const second = { id: "TWO", key: "QA.xlsx:BOS_TC:5", expected: [{ id: "E1", text: "초기 값" }] };
  const started = await h.runner.start(plan([first, second]));
  await h.until(state => state.runId === started.runId && state.status === "done");
  await h.runner.approveAssertion({ runId: started.runId, caseKey: second.key, expectedId: "E1", approved: true });
  const replay = await h.runner.startSavedReplay(plan([second]));
  const done = await h.until(state => state.runId === replay.runId && state.status === "done");
  assert.equal(done.cases[0]!.expected[0]!.verdict, "pass");
  assert.equal(done.budget.modelCalls, 0);
});

test("승인 요청이 겹쳐도 마지막 상태가 결과와 저장 절차에 반영된다", async () => {
  const h = harness([{ action: { type: "judge", expected: "E1", verdict: "pass", observation: "확인", basis: [], assertion: { type: "visibleText", text: "0/30" } } }]);
  const runPlan = plan([{ id: "SAVE-RACE", expected: [{ id: "E1", text: "확인" }] }]);
  const started = await h.runner.start(runPlan);
  const done = await h.until(state => state.runId === started.runId && state.status === "done");
  const request = { runId: started.runId, caseKey: done.cases[0]!.key, expectedId: "E1" };
  await Promise.all([h.runner.approveAssertion({ ...request, approved: true }), h.runner.approveAssertion({ ...request, approved: false })]);
  const runDir = (await readdir(path.join(dir, "runs"))).find(name => name.endsWith(started.runId.slice(0, 8)))!;
  const result = JSON.parse(await readFile(path.join(dir, "runs", runDir, "result.json"), "utf8"));
  const recording = JSON.parse(await readFile(path.join(dir, "recordings", `${recordingKey(runPlan)}.json`), "utf8"));
  assert.equal(result.cases[0].recording[0].approved, false);
  assert.equal(recording[0][0].approved, false);
});

test("빠른 재실행도 TC 동작 한도를 적용한다", async () => {
  const h = harness([]);
  const runPlan = plan([{ id: "REPLAY-LIMIT" }]);
  const verify = (expected: string) => ({ type: "verify", expected, approved: true, candidate: { type: "visibleText", text: "0/30" } });
  const steps = [...Array.from({ length: 40 }, () => verify("E1")), verify("E2")];
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([steps]));
  const started = await h.runner.startSavedReplay(runPlan);
  const done = await h.until(state => state.runId === started.runId && state.status === "done");
  assert.equal(done.budget.actions, 40);
  assert.equal(done.cases[0]!.expected[1]!.verdict, "check");
  assert.match(done.cases[0]!.expected[1]!.observation, /동작 한도/);
});

test("자동 검증 대기 중 주소가 바뀌면 문구 미발견을 Fail로 기록하지 않는다", async () => {
  const h = harness([]);
  const runPlan = plan([{ id: "VERIFY-NAV", expected: [{ id: "E1", text: "문구 확인" }] }]);
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([[{ type: "verify", expected: "E1", approved: true, candidate: { type: "visibleText", text: "없는 문구" } }]]));
  navigateDuringAi = true;
  try {
    const started = await h.runner.startSavedReplay(runPlan);
    const done = await h.until(state => state.runId === started.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.match(done.cases[0]!.expected[0]!.observation, /검증 중 주소가 바뀌어/);
  } finally { navigateDuringAi = false; }
});

test("자동 검증 문구가 여러 개면 Pass 대신 확인 필요로 남긴다", async () => {
  const h = harness([]);
  const runPlan = plan([{ id: "VERIFY-DUP", expected: [{ id: "E1", text: "문구 확인" }] }]);
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([[{ type: "verify", expected: "E1", approved: true, candidate: { type: "visibleText", text: "0/30" } }]]));
  duplicateText = true;
  try {
    const started = await h.runner.startSavedReplay(runPlan);
    const done = await h.until(state => state.runId === started.runId && state.status === "done");
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.match(done.cases[0]!.expected[0]!.observation, /여러 곳/);
  } finally { duplicateText = false; }
});

test("클릭 시도 중 오류가 나면 AI 수정 후보를 요청하지 않는다", async () => {
  const h = harness([]);
  const runPlan = plan([{ id: "CLICK-UNCERTAIN", expected: [{ id: "E1", text: "등록 완료" }] }]);
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([[{ type: "click", target: { role: "button", name: "등록" } }, { type: "verify", expected: "E1", approved: true, candidate: { type: "visibleText", text: "등록 완료" } }]]));
  disabledButton = true;
  try {
    const started = await h.runner.startSavedReplay(runPlan, true);
    const done = await h.until(state => state.runId === started.runId && state.status === "done");
    assert.equal(done.budget.modelCalls, 0);
    assert.equal(done.cases[0]!.repairSuggestion, undefined);
    assert.match(done.cases[0]!.expected[0]!.observation, /반영 여부를 직접 확인/);
  } finally { disabledButton = false; }
});

test("AI 탐색 중 클릭 시도 오류는 재시도하지 않고 중단한다", async () => {
  const h = harness([{ action: { type: "click", target: { role: "button", name: "등록" } } }, { action: { type: "click", target: { role: "button", name: "등록" } } }]);
  disabledButton = true;
  try {
    const started = await h.runner.start(plan([{ id: "AI-CLICK-UNCERTAIN", expected: [{ id: "E1", text: "등록 완료" }] }]));
    const done = await h.until(state => state.runId === started.runId && state.status === "done");
    assert.equal(done.budget.modelCalls, 1);
    assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
    assert.match(done.cases[0]!.expected[0]!.observation, /반영 여부가 불명확/);
  } finally { disabledButton = false; }
});

test("현재 입력값이 고정 검증 문구에 포함되면 자동 판정을 중단한다", async () => {
  const h = harness([]);
  const runPlan = plan([{ id: "VERIFY-DATA", expected: [{ id: "E1", text: "문구 확인" }], data: [{ label: "값", value: "0/30" }] }]);
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([[{ type: "verify", expected: "E1", approved: true, candidate: { type: "visibleText", text: "0/30" } }]]));
  const started = await h.runner.startSavedReplay(runPlan);
  const done = await h.until(state => state.runId === started.runId && state.status === "done");
  assert.equal(done.cases[0]!.expected[0]!.verdict, "check");
  assert.match(done.cases[0]!.expected[0]!.observation, /현재 입력값/);
});

test("데이터에 의존하는 검증 문구는 AI 보조 실행에서 현재 화면으로 판정한다", async () => {
  const h = harness([{ action: { type: "judge", expected: "E1", verdict: "pass", observation: "현재 값 확인", basis: [{ k: "텍스트", v: "0/30" }] } }]);
  const runPlan = plan([{ id: "VERIFY-DATA-AI", expected: [{ id: "E1", text: "문구 확인" }], data: [{ label: "값", value: "0/30" }] }]);
  const folder = path.join(dir, "recordings");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${recordingKey(runPlan)}.json`), JSON.stringify([[{ type: "verify", expected: "E1", approved: true, candidate: { type: "visibleText", text: "0/30" } }]]));
  const started = await h.runner.startSavedReplay(runPlan, true);
  const done = await h.until(state => state.runId === started.runId && state.status === "done");
  assert.equal(done.cases[0]!.expected[0]!.by, "ai");
  assert.equal(done.budget.modelCalls, 1);
});
