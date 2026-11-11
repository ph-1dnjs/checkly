import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { FixtureMaker } from "../../src/app/ipc/ai-tc/fixtures";
import { parsePreparation, preparationPrompt } from "../../src/app/ipc/ai-tc/prepare";

const tc = { key: "QA.xlsx:BOS_TC:4", id: "SC-01-TC01", scenarioId: "SC-01", pre: "", steps: ["배너 이미지를 등록한다"], expected: [{ id: "E1", text: "등록 완료" }], given: "", scenario: "BOS_시나리오 3행: SC-01 | 프로모션 등록 | 모바일 배너 375px" };

test("프롬프트에 오늘 날짜와 시나리오 문맥을 넣는다", () => {
  const prompt = preparationPrompt([tc], "2026-11-03");
  assert.match(prompt, /오늘은 2026-11-03/);
  assert.match(prompt, /모바일 배너 375px/);
});

test("사전 조건 구성용 파일과 검증용 공란을 구분해 준비에 전달한다", () => {
  const prompt = preparationPrompt([{ ...tc,
    pre: "D0: 시작 내일 10:00, 종료 7일 뒤 18:00, 썸네일 570×285 PNG, PC 배너 1540px",
    steps: ["제목을 공란으로 두고 등록 비활성을 확인한다"],
  }], "2026-11-08");
  assert.match(prompt, /사전 조건을 화면에서 구성하는 데 필요한 입력값과 업로드 파일도 준비/);
  assert.match(prompt, /검증용 공란·오류값을 정상값으로 대체하지 않는다/);
  assert.match(prompt, /정의가 없으면.*추정하지 말고/);
  const payload = JSON.parse(prompt.split("TC 목록:\n")[1]!);
  assert.match(payload[0].pre, /570×285 PNG/);
  assert.deepEqual(payload[0].steps, ["제목을 공란으로 두고 등록 비활성을 확인한다"]);
});

test("응답을 검증하고 빠진 TC와 모르는 key는 반환하지 않는다", () => {
  const result = parsePreparation(`설명 {"cases":[{"key":"${tc.key}","data":[{"label":"제목","value":"QA자동_01"}],"files":[{"label":"모바일 배너","type":"png","width":375,"height":200}]},{"key":"other","data":[],"files":[]}]}`, [tc.key, "QA.xlsx:BOS_TC:5"]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.files[0]!.width, 375);
  assert.throws(() => parsePreparation("없음", [tc.key]), /JSON/);
});

test("지원하지 않는 파일만 안내하고 나머지 데이터와 지원 파일은 보존한다", () => {
  const [result] = parsePreparation(`{"cases":[{"key":"${tc.key}","data":[{"label":"제목","value":"테스트"}],"files":[{"label":"사진","type":"JPEG"},{"label":"영상","type":"mp4"}]}]}`, [tc.key]);
  assert.equal(result!.data[0]!.value, "테스트");
  assert.equal(result!.files[0]!.type, "jpg");
  assert.match(result!.note!, /영상 \(mp4\)/);
});

test("파일 5개를 넘어도 준비하고 실행 한도 10개를 넘으면 안내한다", () => {
  const files = Array.from({ length: 11 }, (_, index) => ({ label: `파일 ${index + 1}`, type: "png" }));
  const [six] = parsePreparation(JSON.stringify({ cases: [{ key: tc.key, data: [], files: files.slice(0, 6) }] }), [tc.key]);
  assert.equal(six!.files.length, 6);
  const [eleven] = parsePreparation(JSON.stringify({ cases: [{ key: tc.key, data: [], files }] }), [tc.key]);
  assert.equal(eleven!.files.length, 10);
  assert.match(eleven!.note!, /11개 중 10개/);
});

test("{{len:N}}은 정확히 N자로 바꾼다", () => {
  const [result] = parsePreparation(`{"cases":[{"key":"${tc.key}","data":[{"label":"제목","value":"{{len:20}}"},{"label":"초과","value":"{{ len: 31 }}"}],"files":[]}]}`, [tc.key]);
  assert.deepEqual(result!.data.map(entry => [...entry.value].length), [20, 31]);
});

let dir = "";
let maker: FixtureMaker;
before(async () => { dir = await mkdtemp(path.join(tmpdir(), "checkly-fixture-")); maker = new FixtureMaker(dir); });
after(async () => { await maker.close(); await rm(dir, { recursive: true, force: true }); });

test("이미지는 명세 크기 그대로, JPEG는 용량 한도에 맞춰 만든다", async () => {
  const png = await maker.make({ label: "모바일 배너", type: "png", width: 375, height: 200 }, "SC-01-TC01");
  const head = await readFile(png.filePath);
  assert.equal(head.readUInt32BE(16), 375);
  assert.equal(head.readUInt32BE(20), 200);
  assert.match(png.name, /_375x200\.png$/);
  const jpg = await maker.make({ label: "썸네일", type: "jpg", width: 570, height: 285, maxKB: 30 }, "SC-01-TC01");
  assert.ok(jpg.bytes <= 30 * 1024, `${jpg.bytes} bytes`);
  assert.equal((await readFile(jpg.filePath)).subarray(0, 2).toString("hex"), "ffd8");
});

test("PDF·XLSX·텍스트 파일을 만든다", async () => {
  assert.equal((await readFile((await maker.make({ label: "안내문", type: "pdf" }, "A")).filePath)).subarray(0, 4).toString(), "%PDF");
  assert.equal((await readFile((await maker.make({ label: "목록", type: "xlsx", text: "a,b\n1,2" }, "A")).filePath)).subarray(0, 2).toString(), "PK");
  assert.equal(await readFile((await maker.make({ label: "메모", type: "txt", text: "hello" }, "A")).filePath, "utf8"), "hello");
});
