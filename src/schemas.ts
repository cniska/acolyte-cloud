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

export const setActiveSessionSchema = z.object({
  id: z.string().nullable(),
});
