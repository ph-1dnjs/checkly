import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AiTcRunner } from "../../src/app/ipc/ai-tc/runner";
import type { AiTcRunPlan, AiTcRunState } from "../../src/app/ipc/ai-tc/model";

// 테스트 전용 페이지에서 실제 headless Chromium을 조작한다. 모델은 정해진 답을 차례로 돌려주는 가짜다.
const page = `<!doctype html><html><head><title>카테고리 등록</title></head><body>
<label>카테고리명 <input id="name" /></label><span id="count">0/30</span>
<button onclick="document.getElementById('done').textContent='등록 완료'">등록</button>
<p id="done"></p><a id="out" href="OUT">외부 사이트</a>
<script>document.getElementById('name').addEventListener('input', e => document.getElementById('count').textContent = e.target.value.length + '/30')</script>
</body></html>`;

let server: Server;
let origin = "";
let other = "";
let dir = "";
before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(request.url === "/" ? page.replace("OUT", `${other}/x`) : "<html><body><h1>외부</h1></body></html>");
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

function harness(replies: Array<object | "hang">) {
  const states: AiTcRunState[] = [];
  const prompts: string[] = [];
  let resolveHang: ((text: string) => void) | undefined;
  const listeners: Array<() => void> = [];
  const runner = new AiTcRunner({
    emit: state => { states.push(state); listeners.splice(0).forEach(listener => listener()); },
    preview: () => undefined,
    dataDir: dir,
    toolPath: async () => "/fake/claude",
    resolveFile: () => undefined,
    headless: true,
    ask: input => {
      prompts.push(input.prompt);
      const next = replies.shift();
      if (next === "hang" || !next) return { promise: new Promise<string>(resolve => { resolveHang = resolve; }), cancel: () => undefined };
      return { promise: Promise.resolve(JSON.stringify(next)), cancel: () => undefined };
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
  return { runner, states, prompts, until, lateReply: (text: string) => resolveHang?.(text) };
}

test("입력·관찰 후 판정하고 데이터 변경 클릭을 확인 없이 실행한다", async () => {
  const h = harness([
    { action: { type: "fill", target: { label: "카테고리명" }, value: "가나다", expected: "E1" } },
    { action: { type: "judge", expected: "E1", verdict: "pass", observation: "카운터 3/30", basis: [{ k: "텍스트", v: "3/30" }] } },
    { action: { type: "click", target: { role: "button", name: "등록" }, expected: "E2" } },
    { action: { type: "judge", expected: "E2", verdict: "pass", observation: "등록 완료 표시", basis: [{ k: "텍스트", v: "등록 완료" }] } },
  ]);
  const started = await h.runner.start(plan([{ id: "SC-01-TC04" }]));
  const done = await h.until(state => state.status === "done");
  assert.match(h.prompts[1]!, /3\/30/, "입력 결과를 다시 관찰해 모델에 보낸다");
  assert.deepEqual(done.cases[0]!.expected.map(item => item.verdict), ["pass", "pass"]);
  assert.ok(done.cases[0]!.expected[1]!.captureId, "판정마다 근거 캡처를 남긴다");
  assert.ok(done.cases[0]!.actions.some(action => action.op === "클릭" && action.result === "완료"));
  assert.ok(!h.states.some(state => state.wait?.kind === "confirm"));
  assert.ok(await h.runner.capture(started.runId, done.cases[0]!.expected[1]!.captureId));
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
  h.lateReply(JSON.stringify({ action: { type: "judge", expected: "E1", verdict: "pass", observation: "늦은 응답", basis: [] } }));
  await new Promise(resolve => setTimeout(resolve, 300));
  const last = h.states[h.states.length - 1]!;
  assert.equal(last.status, "cancelled");
  assert.deepEqual(cancelled.cases.flatMap(item => item.expected.map(expected => expected.verdict)), ["pending", "pending", "pending", "pending"]);
  assert.equal(h.runner.current()!.cases[0]!.expected[0]!.observation, "취소로 미실행");
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
  h.runner.decide(started.runId, "resume", "기존 이름은 ABC입니다");
  await h.until(state => state.status === "done");
  assert.match(h.prompts[1]!, /기존 이름은 ABC입니다/);
  assert.match(h.prompts[1]!, /3\/30/);
});
