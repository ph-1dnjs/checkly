import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthFailure, MESSAGES } from "../auth/errors";
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
      .eq("project_id", this.projectId).order("updated_at", { ascending: false });
    if (error) throw error;
    return this.records(data ?? [], await this.memberNames());
  }

  async save(raw: WebScenarioInput): Promise<WebScenarioRecord> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) throw new AuthFailure("시나리오 제목과 본문, 마커 데이터를 확인하세요.");
    const input = parsed.data;
    if (input.id && !input.expectedUpdatedAt) throw new AuthFailure(MESSAGES.conflict);
    const value = { title: input.title, markdown: input.markdown, positions: JSON.parse(input.positions) };
    const names = await this.memberNames();
    const query = input.id
      ? this.client.from("web_scenarios").update(value).eq("project_id", this.projectId)
          .eq("id", input.id).eq("updated_at", input.expectedUpdatedAt!)
      : this.client.from("web_scenarios").insert({ ...value, project_id: this.projectId });
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) throw new AuthFailure(MESSAGES.conflict);
    return this.records([data], names)[0];
  }

  async remove(id: string, expectedUpdatedAt: string): Promise<void> {
    const { data, error } = await this.client.from("web_scenarios").delete()
      .eq("project_id", this.projectId).eq("id", id).eq("updated_at", expectedUpdatedAt).select("id");
    if (error) throw error;
    if (!data?.length) throw new AuthFailure(MESSAGES.conflict);
  }
}
