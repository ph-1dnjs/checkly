import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthFailure, MESSAGES } from "../auth/errors";
import { normalizeDocument } from "./normalize";
import type { RunRecord } from "./scenario";
import type { WebScenarioInput, WebScenarioRecord } from "./types";

const inputSchema = z.object({
  id: z.uuid().optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  positions: z.string().refine(value => {
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed); }
    catch { return false; }
  }),
});

export class WebScenarioStore {
  constructor(private client: SupabaseClient, private projectId: string) {}

  private async memberNames(): Promise<Map<string, string>> {
    const { data, error } = await this.client.from("members").select("user_id,nickname").eq("project_id", this.projectId);
    if (error) throw error;
    return new Map((data ?? []).map(member => [member.user_id, member.nickname]));
  }

  private records(rows: Array<{ id: string; title: string; markdown: string; positions: unknown; updated_at: string; created_by: string | null; updated_by: string | null }>, names: Map<string, string>): WebScenarioRecord[] {
    return rows.map(row => ({
      id: row.id, title: row.title, markdown: row.markdown,
      positions: JSON.stringify(row.positions), updatedAt: row.updated_at,
      createdBy: names.get(row.created_by ?? "") ?? "(나간 멤버)",
      updatedBy: names.get(row.updated_by ?? "") ?? "(나간 멤버)",
    }));
  }

  async list(): Promise<WebScenarioRecord[]> {
    const { data, error } = await this.client.from("web_scenarios").select("*")
      .eq("project_id", this.projectId).is("deleted_at", null).order("created_at", { ascending: true });
    if (error) throw error;
    const names = await this.memberNames();
    const records = this.records(data ?? [], names);
    const { data: items, error: itemError } = await this.client.from("web_scenario_items")
      .select("id,document_id,web_scenario_steps(*)").eq("project_id", this.projectId).is("deleted_at", null);
    if (itemError) throw itemError;
    for (const record of records) {
      const scenarios = (items ?? []).filter(item => item.document_id === record.id);
      if (!scenarios.length) {
        try {
          const migrated = await this.save({ ...record, expectedUpdatedAt: record.updatedAt });
          Object.assign(record, migrated);
        } catch (error) {
          if (!(error instanceof AuthFailure) || error.message !== MESSAGES.conflict) throw error;
          const { data: latest, error: reloadError } = await this.client.from("web_scenarios").select("*")
            .eq("project_id", this.projectId).eq("id", record.id).is("deleted_at", null).maybeSingle();
          if (reloadError) throw reloadError;
          if (latest) Object.assign(record, this.records([latest], names)[0]);
          else records.splice(records.indexOf(record), 1);
        }
      } else {
        record.positions = JSON.stringify(Object.fromEntries(scenarios.map(item => [item.id,
          item.web_scenario_steps.filter((step: any) => step.marker_x !== null && step.marker_y !== null)
            .map((step: any) => ({ databaseId: step.id, action: step.action, target: step.target, value: step.value ?? undefined,
              prompt: step.prompt ?? undefined, condition: step.condition ?? undefined, waitSeconds: step.wait_seconds ?? undefined,
              occurrence: step.occurrence ?? undefined, x: Number(step.marker_x), y: Number(step.marker_y), color: step.marker_color ?? undefined,
              markerViewport: step.marker_viewport, markerPageUrl: step.marker_page_url })),
        ])));
      }
    }
    return records;
  }

  async save(raw: WebScenarioInput): Promise<WebScenarioRecord> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) throw new AuthFailure("시나리오 제목과 본문, 마커 데이터를 확인하세요.");
    const input = parsed.data;
    if (input.id && !input.expectedUpdatedAt) throw new AuthFailure(MESSAGES.conflict);
    const normalized = normalizeDocument(input.markdown, input.positions, !input.id);
    if (!normalized.scenarios.length) throw new AuthFailure("저장할 시나리오를 작성하세요.");
    const names = await this.memberNames();
    const { data, error } = await this.client.rpc("save_web_scenario_document", { p: { ...input,
      markdown: normalized.markdown, positions: JSON.parse(normalized.positions), scenarios: normalized.scenarios,
    } });
    if (error?.message.includes("conflict")) throw new AuthFailure(MESSAGES.conflict);
    if (error) throw error;
    if (!data) throw new AuthFailure(MESSAGES.conflict);
    return this.records([data], names)[0];
  }

  async remove(id: string, expectedUpdatedAt: string): Promise<void> {
    const { error } = await this.client.rpc("delete_web_scenario_document", { p_id: id, p_version: expectedUpdatedAt });
    if (error?.message.includes("conflict")) throw new AuthFailure(MESSAGES.conflict);
    if (error) throw error;
  }

  async saveRun(record: RunRecord): Promise<void> {
    const parsed = runSchema.safeParse(record);
    if (!parsed.success) throw new AuthFailure("실행 기록 데이터를 확인하세요.");
    const { error } = await this.client.rpc("save_web_run", { p: parsed.data });
    if (error) throw error;
  }

  async listRuns(): Promise<RunRecord[]> {
    const { data, error } = await this.client.from("web_runs")
      .select("*,web_run_scenario_results(*,web_run_step_results(*))").eq("project_id", this.projectId)
      .order("started_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []).map(row => {
      const results = row.web_run_scenario_results.sort((a: any, b: any) => a.sort_order - b.sort_order).map((result: any) => ({
        scenario: result.scenario_snapshot, status: result.status, failedStepIndex: result.failed_step_no == null ? undefined : result.failed_step_no - 1,
        message: result.message ?? undefined, startedAt: result.started_at ?? undefined, elapsedSeconds: result.elapsed_seconds ?? undefined, log: result.log,
        stepResults: result.web_run_step_results.sort((a: any, b: any) => a.step_no - b.step_no).map((step: any) => ({
          stepNo: step.step_no, status: step.status, elapsedMs: step.elapsed_ms, errorMessage: step.error_message ?? undefined,
          manualVerdict: step.manual_verdict ?? undefined, manualReason: step.manual_reason ?? undefined,
        })),
      }));
      return { id: row.id, scenarios: results.map((result: any) => result.scenario), results, status: row.status,
        passed: row.passed, failed: row.failed, startedAt: row.started_at, ranAt: row.ended_at,
        trigger: row.trigger, sessionKept: row.session_kept, viewport: row.viewport, browser: row.browser };
    });
  }
}

const stepSchema = z.object({
  id: z.string(), databaseId: z.uuid().optional(), action: z.enum(['goto','fill','fileUpload','click','select','expectText','manualFill','manualControl','manualResult']),
  required: z.boolean().optional(), connected: z.boolean().optional(),
  target: z.string(), value: z.string().optional(), prompt: z.string().optional(), condition: z.string().optional(),
  waitSeconds: z.number().nonnegative().optional(), occurrence: z.number().int().positive().optional(),
  x: z.number().min(0).max(100).optional(), y: z.number().min(0).max(100).optional(), color: z.string().optional(),
  markerViewport: z.enum(['mobile','tablet','desktop']).optional(), markerPageUrl: z.string().optional(),
}).transform(step => step.action === 'fileUpload' ? { ...step, value: '' } : step);
const scenarioSchema = z.object({ id: z.uuid(), title: z.string(), endpointId: z.string().optional(), url: z.string(), tag: z.string().optional(), code: z.string().optional(), sortOrder: z.number().optional(), steps: z.array(stepSchema) });
const runSchema = z.object({
  id: z.uuid(), trigger: z.enum(['editor','picker','rerun','single']), status: z.enum(['passed','failed','cancelled']),
  passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), startedAt: z.iso.datetime(), ranAt: z.iso.datetime(),
  sessionKept: z.boolean(), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }), browser: z.string(),
  scenarios: z.array(scenarioSchema), results: z.array(z.object({
    scenario: scenarioSchema, status: z.enum(['passed','failed','cancelled']), failedStepIndex: z.number().int().nonnegative().optional(),
    message: z.string().optional(), startedAt: z.iso.datetime().optional(), elapsedSeconds: z.number().nonnegative().optional(), log: z.array(z.string()).optional(),
    stepResults: z.array(z.object({ stepNo: z.number().int().positive(), status: z.enum(['passed','failed','skipped','not_run']), elapsedMs: z.number().int().nonnegative(),
      errorMessage: z.string().optional(), manualVerdict: z.enum(['passed','failed']).optional(), manualReason: z.string().optional() })),
  })),
});
