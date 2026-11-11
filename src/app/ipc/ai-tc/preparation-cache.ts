import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AiTcPrepared } from "./model";
import type { PrepareCase } from "./prepare";

const storedSchema = z.object({
  key: z.string(), data: z.array(z.object({ label: z.string(), value: z.string() })),
  files: z.array(z.object({ label: z.string(), name: z.string(), spec: z.string(), file: z.string().uuid() })), note: z.string(),
});

export class PreparationCache {
  constructor(private dir: string, private uploads: Map<string, string>) {}
  private id(item: PrepareCase) { return createHash("sha256").update(JSON.stringify(item)).digest("hex"); }

  async load(item: PrepareCase): Promise<AiTcPrepared | null> {
    try {
      const saved = storedSchema.parse(JSON.parse(await readFile(path.join(this.dir, `${this.id(item)}.json`), "utf8")));
      const files = [];
      for (const file of saved.files) {
        const filePath = path.join(this.dir, file.file);
        if (!(await stat(filePath)).isFile()) return null;
        const token = randomUUID();
        this.uploads.set(token, filePath);
        files.push({ label: file.label, name: file.name, spec: file.spec, token });
      }
      return { key: item.key, data: saved.data, files, note: saved.note };
    } catch { return null; }
  }

  async save(item: PrepareCase, prepared: AiTcPrepared): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = [];
    for (const file of prepared.files) {
      const source = this.uploads.get(file.token);
      if (!source) throw new Error("저장할 업로드 파일을 찾지 못했습니다.");
      const existing = path.dirname(source) === this.dir && z.string().uuid().safeParse(path.basename(source)).success;
      const id = existing ? path.basename(source) : randomUUID();
      if (!existing) await copyFile(source, path.join(this.dir, id));
      files.push({ label: file.label, name: file.name, spec: file.spec, file: id });
    }
    const target = path.join(this.dir, `${this.id(item)}.json`);
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ key: item.key, data: prepared.data, files, note: prepared.note }));
    await rename(temp, target);
  }
}
