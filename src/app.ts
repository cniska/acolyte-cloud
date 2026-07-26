import {
  appendSessionSchema,
  getEmbeddingsSchema,
  listArchiveMemoriesSchema,
  restoreMemoriesSchema,
  retireMemoriesSchema,
  saveSessionSchema,
  searchEmbeddingsSchema,
  searchSessionSchema,
  setActiveSessionSchema,
  touchRecalledSchema,
  writeEmbeddingSchema,
  writeMemorySchema,
} from "@acolyte/cloud-contract";
import { apiReference } from "@scalar/hono-api-reference";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { verifyAuth } from "./auth.js";
import { getDb } from "./db.js";
import { stripNulls } from "./json.js";
import { base64ToVector, parseJson, vectorToBase64 } from "./parse.js";

const app = new OpenAPIHono();
const tags = {
  memories: ["Memories"],
  embeddings: ["Embeddings"],
  sessions: ["Sessions"],
};
const bearerSecurity = [{ bearerAuth: [] }];
const noContent = { 204: { description: "No content" } };
const scalarCdn = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.63.0";
const validMemoryKinds = new Set(["observation", "stored"]);
const errorResponse = (error: string) => Response.json({ error }, { status: 400 });
const healthResponseSchema = z.object({ status: z.literal("ok") }).openapi("HealthResponse");

async function appendSession(c: Context) {
  const owner = await ownerId(c.req.raw);
  if (isResponse(owner)) return owner;
  const body = await parseJson(c.req.raw);
  if (!body) return errorResponse("Invalid JSON");
  const parsed = appendSessionSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);
  const { messages, tokenUsage, updatedAt, model, title, workspace, workspaceName, workspaceBranch } = parsed.data;
  const sets = ["updated_at = $3"];
  const params: unknown[] = [owner, c.req.param("id"), updatedAt];
  if (messages) {
    sets.push(`messages = messages || $${params.length + 1}::jsonb`);
    params.push(JSON.stringify(messages));
  }
  if (tokenUsage) {
    sets.push(`token_usage = token_usage || $${params.length + 1}::jsonb`);
    params.push(JSON.stringify(tokenUsage));
  }
  for (const [column, value] of [
    ["model", model],
    ["title", title],
    ["workspace", workspace],
    ["workspace_name", workspaceName],
    ["workspace_branch", workspaceBranch],
  ] as const) {
    if (value !== undefined) {
      sets.push(`${column} = $${params.length + 1}`);
      params.push(value);
    }
  }
  const result = await getDb()(
    `UPDATE sessions SET ${sets.join(", ")} WHERE owner_id = $1 AND id = $2 RETURNING id`,
    params,
  );
  return result.length === 0 ? c.json({ error: "Session not found" }, 404) : c.body(null, 204);
}

async function ownerId(request: Request): Promise<string | Response> {
  const auth = await verifyAuth(request);
  return auth.ok ? auth.ownerId : auth.error;
}

function isResponse(value: string | Response): value is Response {
  return value instanceof Response;
}

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.doc("/api/doc", {
  openapi: "3.0.3",
  info: { title: "Acolyte Cloud API", version: "1.0.0", description: "Authenticated memory and session storage." },
});

app.get("/api/reference", apiReference({ cdn: scalarCdn, url: "/doc", pageTitle: "Acolyte Cloud API reference" }));
app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    tags: ["System"],
    summary: "Check API availability",
    responses: { 200: { content: { "application/json": { schema: healthResponseSchema } }, description: "Available" } },
  }),
  (c) => c.json({ status: "ok" as const }),
);

app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/memories",
    tags: tags.memories,
    security: bearerSecurity,
    responses: {
      200: { description: "Memories" },
      400: { description: "Invalid kind" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const scopeKey = c.req.query("scopeKey");
    const kind = c.req.query("kind");
    if (kind && !validMemoryKinds.has(kind)) return errorResponse("Invalid kind");
    const conditions = ["owner_id = $1"];
    const params: unknown[] = [owner];
    if (scopeKey) {
      conditions.push(`scope_key = $${params.length + 1}`);
      params.push(scopeKey);
    }
    if (kind) {
      conditions.push(`kind = $${params.length + 1}`);
      params.push(kind);
    }
    const rows = await getDb()(
      `SELECT id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate",
              created_at AS "createdAt", last_recalled_at AS "lastRecalledAt", topic
       FROM memories WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return c.json(rows);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories",
    tags: tags.memories,
    security: bearerSecurity,
    responses: { ...noContent, 400: { description: "Invalid request" }, 401: { description: "Unauthorized" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = writeMemorySchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const { record } = parsed.data;
    await getDb()(
      `INSERT INTO memories (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (owner_id, id) DO UPDATE SET scope_key = EXCLUDED.scope_key, kind = EXCLUDED.kind,
         content = EXCLUDED.content, token_estimate = EXCLUDED.token_estimate,
         last_recalled_at = EXCLUDED.last_recalled_at, topic = EXCLUDED.topic`,
      [
        record.id,
        owner,
        record.scopeKey,
        record.kind,
        record.content,
        record.tokenEstimate,
        record.createdAt,
        record.lastRecalledAt ?? null,
        record.topic ?? null,
      ],
    );
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/api/v1/memories/{id}",
    tags: tags.memories,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    await getDb()("DELETE FROM memories WHERE owner_id = $1 AND id = $2", [owner, c.req.param("id")]);
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/touch-recalled",
    tags: tags.memories,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = touchRecalledSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const placeholders = parsed.data.ids.map((_, i) => `$${i + 2}`).join(", ");
    await getDb()(`UPDATE memories SET last_recalled_at = now() WHERE owner_id = $1 AND id IN (${placeholders})`, [
      owner,
      ...parsed.data.ids,
    ]);
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/retire",
    tags: tags.memories,
    security: bearerSecurity,
    responses: { 200: { description: "Retired memory IDs" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = retireMemoriesSchema.safeParse(await parseJson(c.req.raw));
    if (!parsed.success) return errorResponse(parsed.error.message);
    const { ids, disposition } = parsed.data;
    const rows = await getDb()(
      `WITH moved AS (DELETE FROM memories WHERE owner_id = $1 AND id = ANY($2) RETURNING *),
       archived AS (INSERT INTO memory_archive (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic, disposition, superseded_by)
         SELECT id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic, $3, $4 FROM moved RETURNING id),
       deleted_embeddings AS (DELETE FROM memory_embeddings WHERE owner_id = $1 AND id IN (SELECT id FROM moved)) SELECT id FROM archived`,
      [owner, ids, disposition.kind, disposition.kind === "superseded" ? JSON.stringify(disposition.by) : null],
    );
    return c.json({ retired: rows.map((row) => row.id) });
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/memories/archive",
    tags: tags.memories,
    security: bearerSecurity,
    responses: { 200: { description: "Archived memories" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = listArchiveMemoriesSchema.safeParse(c.req.query());
    if (!parsed.success) return errorResponse(parsed.error.message);
    const conditions = ["owner_id = $1"];
    const params: unknown[] = [owner];
    for (const [column, value] of Object.entries(parsed.data))
      if (value) {
        conditions.push(`${column === "scopeKey" ? "scope_key" : column} = $${params.length + 1}`);
        params.push(value);
      }
    const rows = await getDb()(
      `SELECT id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate", created_at AS "createdAt",
              last_recalled_at AS "lastRecalledAt", topic, retired_at AS "retiredAt", disposition, superseded_by AS "supersededBy"
       FROM memory_archive WHERE ${conditions.join(" AND ")} ORDER BY retired_at DESC`,
      params,
    );
    return c.json(
      rows.map(({ disposition, supersededBy, ...record }) => ({
        ...record,
        disposition: disposition === "superseded" ? { kind: disposition, by: supersededBy } : { kind: disposition },
      })),
    );
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/restore",
    tags: tags.memories,
    security: bearerSecurity,
    responses: { 200: { description: "Restored memories" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = restoreMemoriesSchema.safeParse(await parseJson(c.req.raw));
    if (!parsed.success) return errorResponse(parsed.error.message);
    const rows = await getDb()(
      `WITH restored AS (DELETE FROM memory_archive WHERE owner_id = $1 AND id = ANY($2) RETURNING *),
       inserted AS (INSERT INTO memories (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic)
         SELECT id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic FROM restored
         RETURNING id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate", created_at AS "createdAt", last_recalled_at AS "lastRecalledAt", topic) SELECT * FROM inserted`,
      [owner, parsed.data.ids],
    );
    return c.json(rows);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/embeddings",
    tags: tags.embeddings,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = writeEmbeddingSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const vector = base64ToVector(parsed.data.embedding);
    if (!vector) return errorResponse("Invalid embedding");
    await getDb()(
      `INSERT INTO memory_embeddings (id, owner_id, scope_key, embedding) VALUES ($1, $2, $3, $4)
      ON CONFLICT (owner_id, id) DO UPDATE SET scope_key = EXCLUDED.scope_key, embedding = EXCLUDED.embedding`,
      [parsed.data.id, owner, parsed.data.scopeKey, vector],
    );
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/api/v1/memories/embeddings/{id}",
    tags: tags.embeddings,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    await getDb()("DELETE FROM memory_embeddings WHERE owner_id = $1 AND id = $2", [owner, c.req.param("id")]);
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/embeddings/get",
    tags: tags.embeddings,
    security: bearerSecurity,
    responses: { 200: { description: "Embeddings" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = getEmbeddingsSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    if (parsed.data.ids.length === 0) return c.json({ embeddings: {} });
    const placeholders = parsed.data.ids.map((_, i) => `$${i + 2}`).join(", ");
    const rows = await getDb()(
      `SELECT id, embedding::text FROM memory_embeddings WHERE owner_id = $1 AND id IN (${placeholders})`,
      [owner, ...parsed.data.ids],
    );
    const embeddings: Record<string, string> = {};
    for (const row of rows) embeddings[row.id as string] = vectorToBase64(row.embedding as string);
    return c.json({ embeddings });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/memories/embeddings/search",
    tags: tags.embeddings,
    security: bearerSecurity,
    responses: { 200: { description: "Matching memories" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = searchEmbeddingsSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const vector = base64ToVector(parsed.data.queryEmbedding);
    if (!vector) return errorResponse("Invalid embedding");
    const { scopeKey, kind, limit } = parsed.data;
    const conditions = ["e.owner_id = $1"];
    const params: unknown[] = [owner];
    if (scopeKey) {
      conditions.push(`e.scope_key = $${params.length + 1}`);
      params.push(scopeKey);
    }
    if (kind) {
      conditions.push(`m.kind = $${params.length + 1}`);
      params.push(kind);
    }
    params.push(vector);
    const vectorParam = `$${params.length}`;
    params.push(limit);
    const rows = await getDb()(
      `SELECT m.id, m.scope_key AS "scopeKey", m.kind, m.content, m.token_estimate AS "tokenEstimate", m.created_at AS "createdAt", m.last_recalled_at AS "lastRecalledAt", m.topic
       FROM memory_embeddings e JOIN memories m ON m.owner_id = e.owner_id AND m.id = e.id WHERE ${conditions.join(" AND ")}
       ORDER BY e.embedding <=> ${vectorParam}::vector LIMIT $${params.length}`,
      params,
    );
    return c.json(rows);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/sessions",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: { 200: { description: "Sessions" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const rows = await getDb()(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title, workspace,
      workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch", messages, token_usage AS "tokenUsage"
      FROM sessions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [owner, limit],
    );
    return c.json(rows.map(stripNulls));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/sessions",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = saveSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const session = parsed.data;
    await getDb()(
      `INSERT INTO sessions (id, owner_id, created_at, updated_at, model, title, workspace, workspace_name, workspace_branch, messages, token_usage)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (owner_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at,
      model = EXCLUDED.model, title = EXCLUDED.title, workspace = EXCLUDED.workspace, workspace_name = EXCLUDED.workspace_name,
      workspace_branch = EXCLUDED.workspace_branch, messages = EXCLUDED.messages, token_usage = EXCLUDED.token_usage`,
      [
        session.id,
        owner,
        session.createdAt,
        session.updatedAt,
        session.model,
        session.title,
        session.workspace ?? null,
        session.workspaceName ?? null,
        session.workspaceBranch ?? null,
        JSON.stringify(session.messages),
        JSON.stringify(session.tokenUsage),
      ],
    );
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/sessions/active",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: { 200: { description: "Active session" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const rows = await getDb()("SELECT session_id FROM active_sessions WHERE owner_id = $1", [owner]);
    return c.json({ id: (rows[0]?.session_id as string) ?? null });
  },
);

app.openapi(
  createRoute({
    method: "put",
    path: "/api/v1/sessions/active",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = setActiveSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    await getDb()(
      `INSERT INTO active_sessions (owner_id, session_id) VALUES ($1, $2)
      ON CONFLICT (owner_id) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [owner, parsed.data.id],
    );
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/api/v1/sessions/{id}",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: { 200: { description: "Session or null" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const rows = await getDb()(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title, workspace,
      workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch", messages, token_usage AS "tokenUsage"
      FROM sessions WHERE owner_id = $1 AND id = $2`,
      [owner, c.req.param("id")],
    );
    return c.json(rows[0] ? stripNulls(rows[0]) : null);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/api/v1/sessions/{id}/append",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: { ...noContent, 404: { description: "Session not found" } },
  }),
  appendSession,
);

app.patch("/api/v1/sessions/{id}", appendSession);

app.openapi(
  createRoute({
    method: "delete",
    path: "/api/v1/sessions/{id}",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: noContent,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    await getDb()("DELETE FROM sessions WHERE owner_id = $1 AND id = $2", [owner, c.req.param("id")]);
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/v1/sessions/{id}/search",
    tags: tags.sessions,
    security: bearerSecurity,
    responses: { 200: { description: "Matching messages" } },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse("Invalid JSON");
    const parsed = searchSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.message);
    const rows = await getDb()(
      `SELECT m.value FROM sessions s, jsonb_array_elements(s.messages) AS m WHERE s.owner_id = $1 AND s.id = $2
      AND m.value->>'kind' IS DISTINCT FROM 'status' AND m.value->>'content' ILIKE '%' || $3 || '%' LIMIT $4`,
      [owner, c.req.param("id"), parsed.data.query, parsed.data.limit ?? 10],
    );
    return c.json(rows.map((row) => row.value));
  },
);

app.all("/api/v1/*", (c) => c.json({ error: "Method not allowed" }, 405));

for (const [method, path, schema, description, routeTags] of [
  ["post", "/api/v1/memories", writeMemorySchema, "A memory record to create or update.", tags.memories],
  ["post", "/api/v1/memories/touch-recalled", touchRecalledSchema, "Memory ids to mark recalled.", tags.memories],
  [
    "post",
    "/api/v1/memories/retire",
    retireMemoriesSchema,
    "Memory ids and their retirement disposition.",
    tags.memories,
  ],
  ["post", "/api/v1/memories/restore", restoreMemoriesSchema, "Archived memory ids to restore.", tags.memories],
  ["post", "/api/v1/memories/embeddings", writeEmbeddingSchema, "An embedding to write.", tags.embeddings],
  ["post", "/api/v1/memories/embeddings/get", getEmbeddingsSchema, "Embedding ids to retrieve.", tags.embeddings],
  [
    "post",
    "/api/v1/memories/embeddings/search",
    searchEmbeddingsSchema,
    "An embedding similarity query.",
    tags.embeddings,
  ],
  ["post", "/api/v1/sessions", saveSessionSchema, "A session to create or update.", tags.sessions],
  ["put", "/api/v1/sessions/active", setActiveSessionSchema, "The active session id.", tags.sessions],
  ["patch", "/api/v1/sessions/{id}/append", appendSessionSchema, "An incremental session update.", tags.sessions],
  ["post", "/api/v1/sessions/{id}/search", searchSessionSchema, "A session message query.", tags.sessions],
] as const) {
  app.openAPIRegistry.registerPath({
    method,
    path,
    tags: routeTags,
    security: bearerSecurity,
    request: { body: { content: { "application/json": { schema } }, description, required: true } },
    responses: {
      200: { description: "Success" },
      204: { description: "No content" },
      400: { description: "Invalid request" },
    },
  });
}

export { app };
export default app;
