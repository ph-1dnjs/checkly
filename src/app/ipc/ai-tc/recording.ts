import type { AiAction } from "./ai";
import type { AiTcRunPlan } from "./model";
import { createHash } from "node:crypto";
import { z } from "zod";

type Target = { role?: string; name?: string; text?: string; label?: string; placeholder?: string; nth?: number };
export type RecordedStep =
  | { type: "click"; target: Target; expected?: string }
  | { type: "fill"; target: Target; dataLabel: string; expected?: string }
  | { type: "select"; target: Target; dataLabel: string; expected?: string }
  | { type: "goto"; url: string; expected?: string }
  | { type: "press"; key: string; target?: Target; expected?: string }
  | { type: "scroll"; direction: "up" | "down"; expected?: string }
  | { type: "wait"; seconds: number; expected?: string }
  | { type: "verify"; expected: string; candidate?: { type: "visibleText"; text: string }; approved: boolean }
  | { type: "manual"; reason: string };

const targetSchema = z.object({ role: z.string().max(40).optional(), name: z.string().max(300).optional(), text: z.string().max(300).optional(), label: z.string().max(300).optional(), placeholder: z.string().max(300).optional(), nth: z.number().int().min(0).max(50).optional() }).strict().refine(value => value.role || value.text || value.label || value.placeholder);
const expected = z.string().regex(/^E\d{1,2}$/).optional();
export const recordingSchema = z.array(z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), target: targetSchema, expected }).strict(),
  z.object({ type: z.literal("fill"), target: targetSchema, dataLabel: z.string().min(1).max(200), expected }).strict(),
  z.object({ type: z.literal("select"), target: targetSchema, dataLabel: z.string().min(1).max(200), expected }).strict(),
  z.object({ type: z.literal("goto"), url: z.string().url().max(2000).refine(value => { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }), expected }).strict(),
  z.object({ type: z.literal("press"), key: z.string().regex(/^[A-Za-z0-9+]{1,30}$/), target: targetSchema.optional(), expected }).strict(),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), expected }).strict(),
  z.object({ type: z.literal("wait"), seconds: z.number().min(0.5).max(10), expected }).strict(),
  z.object({ type: z.literal("verify"), expected: z.string().regex(/^E\d{1,2}$/), approved: z.boolean(), candidate: z.object({ type: z.literal("visibleText"), text: z.string().min(1).max(300) }).strict().optional() }).strict(),
  z.object({ type: z.literal("manual"), reason: z.string().max(300) }).strict(),
])).max(200)).max(500);

/** TC 원문과 환경이 바뀌면 다른 절차로 취급한다. 입력값과 파일 경로는 저장하지 않는다. */
export function recordingKey(plan: AiTcRunPlan): string {
  const identity = { startUrl: plan.startUrl, allowedHosts: plan.allowedHosts, environmentLabel: plan.environmentLabel, cases: plan.cases.map(({ key, id, pre, steps, expected, after, readyRefs }) => ({ key, id, pre, steps, expected, after, readyRefs })) };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/** 실행된 동작만 변환한다. 화면에서 얻은 값과 판정은 재사용하지 않는다. */
export function recordStep(action: AiAction, data: Array<{ label: string; value: string }>): RecordedStep {
  if (action.type === "judge") {
    // 입력값이 들어간 고정 문구는 다음 실행의 데이터와 달라질 수 있다. 자동 조건으로 확정하지 않는다.
    const candidate = action.assertion && !data.some(item => item.value.trim() && action.assertion!.text.includes(item.value)) ? action.assertion : undefined;
    return { type: "verify", expected: action.expected, approved: false, ...(candidate ? { candidate } : {}) };
  }
  if (action.type === "click") return { type: "click", target: action.target, ...(action.expected ? { expected: action.expected } : {}) };
  if (action.type === "goto") {
    try {
      const url = new URL(action.url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      return { type: "goto", url: url.toString(), ...(action.expected ? { expected: action.expected } : {}) };
    } catch { return { type: "manual", reason: "주소에 확인이 필요한 값이 있습니다" }; }
  }
  if (action.type === "press" || action.type === "scroll" || action.type === "wait") return action;
  if (action.type === "fill" || action.type === "select") {
    const matches = data.filter(item => item.value === action.value && item.label && item.value);
    if (matches.length === 1 && data.filter(item => item.label === matches[0]!.label).length === 1) {
      return { type: action.type, target: action.target, dataLabel: matches[0]!.label, ...(action.expected ? { expected: action.expected } : {}) };
    }
    return { type: "manual", reason: "입력값을 준비 데이터에 안전하게 연결할 수 없음" };
  }
  return { type: "manual", reason: `${action.type} 동작은 재실행 전 확인이 필요함` };
}
