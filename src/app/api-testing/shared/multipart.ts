import { z } from "zod";

export const maxUploadBytes = 5 * 1024 * 1024;
export const uploadFileSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(200),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("inline"), base64: z.string().max(Math.ceil(maxUploadBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
    z.object({ kind: z.literal("generated"), format: z.enum(["txt", "csv", "json"]), size: z.number().int().min(1).max(maxUploadBytes) }).strict(),
  ]),
}).strict();
export const multipartSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), name: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal("file"), name: z.string().min(1), file: uploadFileSchema }).strict(),
])).max(20);
export type Multipart = z.infer<typeof multipartSchema>;

/** ASCII fixtures make the requested byte count deterministic, including valid JSON. */
export function generateUpload(format: "txt" | "csv" | "json", size: number): string {
  if (!Number.isInteger(size) || size < 1 || size > maxUploadBytes) throw new Error("파일 크기는 1바이트~5MB로 지정하세요");
  if (format === "json") return "0" + " ".repeat(size - 1);
  if (format === "csv") return size === 1 ? "a" : "a\n" + " ".repeat(size - 2);
  return "x".repeat(size);
}
