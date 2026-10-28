import { z } from "zod";

const pointer = z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/);
/** Applied in order: where, limit, minimum count, map, index. */
export const selectionSchema = z.object({
  where: z.object({ pointer, equals: z.json() }).strict().optional(),
  limit: z.number().int().positive().optional(),
  minItems: z.number().int().nonnegative().optional(),
  map: pointer.optional(),
  index: z.number().int().nonnegative().optional(),
}).strict().superRefine((selection, ctx) => {
  if (selection.limit !== undefined && selection.minItems !== undefined && selection.minItems > selection.limit)
    ctx.addIssue({ code: "custom", message: "minItems는 limit보다 클 수 없습니다" });
});
export type Selection = z.infer<typeof selectionSchema>;
