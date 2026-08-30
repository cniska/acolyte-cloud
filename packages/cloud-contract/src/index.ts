import { z } from "zod/v4";

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().min(1),
  kind: z.enum(["observation", "stored"]),
  content: z.string().min(1),
  createdAt: z.string().min(1),
  tokenEstimate: z.number().int().min(0),
  lastRecalledAt: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
});

export const writeMemorySchema = z.object({
  record: memoryRecordSchema,
  scope: z.enum(["user", "project", "session"]).optional(),
});

export const touchRecalledSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const memoryDispositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("superseded"), by: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("capacity") }),
  z.object({ kind: z.literal("noise") }),
]);

export const retireMemoriesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  disposition: memoryDispositionSchema,
});

export const restoreMemoriesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const listArchiveMemoriesSchema = z.object({
  scopeKey: z.string().min(1).optional(),
  kind: z.enum(["observation", "stored"]).optional(),
  disposition: z.enum(["superseded", "capacity", "noise"]).optional(),
});

export const memoryArchiveRecordSchema = memoryRecordSchema.extend({
  retiredAt: z.string().min(1),
  disposition: memoryDispositionSchema,
});

export const writeArchiveMemorySchema = z.object({ record: memoryArchiveRecordSchema });

export const writeEmbeddingSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().min(1),
  embedding: z.string().min(1),
});

export const getEmbeddingsSchema = z.object({
  ids: z.array(z.string().min(1)),
});

export const searchEmbeddingsSchema = z.object({
  queryEmbedding: z.string().min(1),
  scopeKey: z.string().optional(),
  kind: z.enum(["observation", "stored"]).optional(),
  limit: z.number().int().min(1).max(100),
});

export const saveSessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  model: z.string().min(1),
  title: z.string(),
  workspace: z.string().optional(),
  workspaceName: z.string().optional(),
  workspaceBranch: z.string().optional(),
  messages: z.array(z.unknown()),
  tokenUsage: z.array(z.unknown()),
});

export const appendSessionSchema = z.object({
  messages: z.array(z.unknown()).min(1).optional(),
  tokenUsage: z.array(z.unknown()).min(1).optional(),
  updatedAt: z.string().min(1),
  model: z.string().min(1).optional(),
  title: z.string().optional(),
  workspace: z.string().optional(),
  workspaceName: z.string().optional(),
  workspaceBranch: z.string().optional(),
});

export const searchSessionSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const setActiveSessionSchema = z.object({
  id: z.string().nullable(),
});

export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type WriteMemory = z.infer<typeof writeMemorySchema>;
export type TouchRecalled = z.infer<typeof touchRecalledSchema>;
export type MemoryDisposition = z.infer<typeof memoryDispositionSchema>;
export type RetireMemories = z.infer<typeof retireMemoriesSchema>;
export type RestoreMemories = z.infer<typeof restoreMemoriesSchema>;
export type ListArchiveMemories = z.infer<typeof listArchiveMemoriesSchema>;
export type MemoryArchiveRecord = z.infer<typeof memoryArchiveRecordSchema>;
export type WriteArchiveMemory = z.infer<typeof writeArchiveMemorySchema>;
export type WriteEmbedding = z.infer<typeof writeEmbeddingSchema>;
export type GetEmbeddings = z.infer<typeof getEmbeddingsSchema>;
export type SearchEmbeddings = z.infer<typeof searchEmbeddingsSchema>;
export type SaveSession = z.infer<typeof saveSessionSchema>;
export type AppendSession = z.infer<typeof appendSessionSchema>;
export type SearchSession = z.infer<typeof searchSessionSchema>;
export type SetActiveSession = z.infer<typeof setActiveSessionSchema>;
