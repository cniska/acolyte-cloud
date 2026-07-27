import {
  appendSessionSchema,
  getEmbeddingsSchema,
  listArchiveMemoriesSchema,
  memoryArchiveRecordSchema,
  memoryRecordSchema,
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
import { invalidRequestMessage, notFound, onError, validationHook } from "./errors.js";
import { stripNulls } from "./json.js";
import { type AppEnv, observability } from "./observability.js";
import { base64ToVector, parseJson, vectorToBase64 } from "./parse.js";

const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
app.use("*", observability);
app.notFound(notFound);
app.onError(onError);
const tags = {
  memories: ["Memories"],
  embeddings: ["Embeddings"],
  sessions: ["Sessions"],
};
const bearerSecurity = [{ bearerAuth: [] }];
const errorSchema = z
  .object({ error: z.string(), requestId: z.string() })
  .openapi("Error", { description: "A request failure and why, tagged with the request id from the response header." });
// verifyAuth() rejects with a plain-text Response, not JSON: the 401 schema
// must match that or the doc would describe a body the API never sends.
const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const plainTextError = (description: string) => ({
  description,
  content: { "text/plain": { schema: z.string() } },
});
const noContent = { 204: { description: "No content" } };
const unauthorized = { 401: plainTextError("Unauthorized") };
const invalidRequest = { 400: jsonError("Invalid request"), ...unauthorized };
const noContentResponses = { ...noContent, ...invalidRequest };
const successResponses = { 200: { description: "Success" }, ...invalidRequest };
const appendResponses = { ...noContentResponses, 404: jsonError("Session not found") };
const scalarCdn = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.63.0";
const validMemoryKinds = new Set(["observation", "stored"]);
const errorResponse = (c: Context<AppEnv>, error: string) =>
  Response.json({ error, requestId: c.get("requestId") }, { status: 400 });
const healthResponseSchema = z
  .object({ status: z.literal("ok") })
  .openapi("HealthResponse", { description: "Confirms the API is reachable." });
const idParams = z.object({ id: z.string().min(1) });
const memoryListQuery = z.object({
  scopeKey: z.string().optional(),
  kind: z.enum(["observation", "stored"]).optional(),
});
const sessionListQuery = z.object({ limit: z.coerce.number().int().positive().optional() });
const memoryRecordDoc = z
  .object(memoryRecordSchema.shape)
  .openapi("MemoryRecord", { description: "A durable memory record scoped to a user, project, or session." });
const memoryArchiveRecordDoc = z
  .object(memoryArchiveRecordSchema.shape)
  .openapi("MemoryArchiveRecord", { description: "A retired memory record, kept for restoration or audit." });
const memoryListResponseSchema = z
  .array(memoryRecordDoc)
  .openapi("MemoryList", { description: "Memory records matching a query." });
const memoryArchiveListResponseSchema = z
  .array(memoryArchiveRecordDoc)
  .openapi("MemoryArchiveList", { description: "Archived memory records matching a query." });
const retireResultSchema = z
  .object({ retired: z.array(z.string()) })
  .openapi("RetireResult", { description: "Ids of the memories that were retired." });
const embeddingsResultSchema = z
  .object({ embeddings: z.record(z.string(), z.string()) })
  .openapi("EmbeddingsResult", { description: "Base64-encoded vector embeddings, keyed by memory id." });
const sessionSchema = z
  .object(saveSessionSchema.shape)
  .openapi("Session", { description: "A chat session transcript." });
const sessionListResponseSchema = z
  .array(sessionSchema)
  .openapi("SessionList", { description: "Sessions matching a query." });
const activeSessionSchema = z
  .object({ id: z.string().nullable() })
  .openapi("ActiveSession", { description: "The id of the owner's active session, or null if none is set." });
const sessionMessagesResponseSchema = z
  .array(z.unknown())
  .openapi("SessionMessages", { description: "Messages within a session matching a search query." });

async function appendSession(c: Context) {
  const owner = await ownerId(c.req.raw);
  if (isResponse(owner)) return owner;
  const body = await parseJson(c.req.raw);
  if (!body) return errorResponse(c, "Invalid JSON");
  const parsed = appendSessionSchema.safeParse(body);
  if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
  return result.length === 0
    ? c.json({ error: "Session not found", requestId: c.get("requestId") }, 404)
    : c.body(null, 204);
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

const openApiDoc = {
  openapi: "3.0.3" as const,
  info: { title: "Acolyte Cloud API", version: "1.0.0", description: "Authenticated memory and session storage." },
  servers: [{ url: "https://cloud.acolyte.sh", description: "Production" }],
  tags: [
    { name: "System", description: "Service health." },
    { name: "Memories", description: "Durable memory records scoped to a user, project, or session." },
    { name: "Embeddings", description: "Vector embeddings backing semantic memory search." },
    { name: "Sessions", description: "Chat session transcripts and the active-session pointer." },
  ],
};
const referenceConfig = { cdn: scalarCdn, url: "/doc", pageTitle: "Acolyte Cloud API reference" };

const favicon =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJSb2JvdCBlbW9qaSBmYXZpY29uIj48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iNTIiPvCfpJY8L3RleHQ+PC9zdmc+";

const landingPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="${favicon}">
  <title>Acolyte Cloud</title>
  <style>
    @keyframes cursor-blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #020617;
      color: #A56EFF;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      font-size: 1.25rem;
      letter-spacing: 0.03em;
      gap: 0.25em;
    }
    .prompt {
      font-size: 0.78em;
      opacity: 0.7;
    }
    .cursor {
      display: inline-block;
      height: 1.05em;
      width: 0.55em;
      background: currentColor;
      opacity: 0.5;
      animation: cursor-blink 1s steps(2, start) infinite;
    }
  </style>
</head>
<body>
  <span class="logo">
    <span class="prompt">&#10095;</span>
    <span>acolyte</span>
    <span class="cursor"></span>
  </span>
</body>
</html>`;

app.get("/", (c) => c.html(landingPage));

app.doc("/api/doc", openApiDoc);
app.doc("/doc", openApiDoc);

app.get("/api/reference", apiReference(referenceConfig));
app.get("/reference", apiReference(referenceConfig));

app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    tags: ["System"],
    operationId: "checkHealth",
    summary: "Check API availability",
    responses: { 200: { content: { "application/json": { schema: healthResponseSchema } }, description: "Available" } },
  }),
  (c) => c.json({ status: "ok" as const }),
);
app.get("/health", (c) => c.json({ status: "ok" as const }));

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
    if (kind && !validMemoryKinds.has(kind)) return errorResponse(c, "Invalid kind");
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
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = writeMemorySchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    operationId: "deleteMemory",
    summary: "Delete a memory",
    request: { params: idParams },
    responses: { ...noContent, ...unauthorized },
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
    responses: noContentResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = touchRecalledSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: successResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = retireMemoriesSchema.safeParse(await parseJson(c.req.raw));
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: { 200: { description: "Archived memories" }, ...invalidRequest },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = listArchiveMemoriesSchema.safeParse(c.req.query());
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: successResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const parsed = restoreMemoriesSchema.safeParse(await parseJson(c.req.raw));
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: noContentResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = writeEmbeddingSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
    const vector = base64ToVector(parsed.data.embedding);
    if (!vector) return errorResponse(c, "Invalid embedding");
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
    operationId: "deleteEmbedding",
    summary: "Delete an embedding",
    request: { params: idParams },
    responses: { ...noContent, ...unauthorized },
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
    responses: { 200: { description: "Embeddings" }, ...invalidRequest },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = getEmbeddingsSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: { 200: { description: "Matching memories" }, ...invalidRequest },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = searchEmbeddingsSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
    const vector = base64ToVector(parsed.data.queryEmbedding);
    if (!vector) return errorResponse(c, "Invalid embedding");
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
    responses: { 200: { description: "Sessions" }, ...unauthorized },
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
    responses: noContentResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = saveSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    responses: { 200: { description: "Active session" }, ...unauthorized },
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
    responses: noContentResponses,
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = setActiveSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
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
    request: { params: idParams },
    responses: { 200: { description: "Session or null" }, ...unauthorized },
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
    request: { params: idParams },
    responses: appendResponses,
  }),
  appendSession,
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/api/v1/sessions/{id}",
    tags: tags.sessions,
    security: bearerSecurity,
    operationId: "deleteSession",
    summary: "Delete a session",
    request: { params: idParams },
    responses: { ...noContent, ...unauthorized },
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
    request: { params: idParams },
    responses: { 200: { description: "Matching messages" }, ...invalidRequest },
  }),
  async (c) => {
    const owner = await ownerId(c.req.raw);
    if (isResponse(owner)) return owner;
    const body = await parseJson(c.req.raw);
    if (!body) return errorResponse(c, "Invalid JSON");
    const parsed = searchSessionSchema.safeParse(body);
    if (!parsed.success) return errorResponse(c, invalidRequestMessage(parsed.error));
    const rows = await getDb()(
      `SELECT m.value FROM sessions s, jsonb_array_elements(s.messages) AS m WHERE s.owner_id = $1 AND s.id = $2
      AND m.value->>'kind' IS DISTINCT FROM 'status' AND m.value->>'content' ILIKE '%' || $3 || '%' LIMIT $4`,
      [owner, c.req.param("id"), parsed.data.query, parsed.data.limit ?? 10],
    );
    return c.json(rows.map((row) => row.value));
  },
);

app.all("/api/v1/*", async (c) => {
  const owner = await ownerId(c.req.raw);
  return isResponse(owner) ? owner : c.json({ error: "Method not allowed", requestId: c.get("requestId") }, 405);
});

for (const route of [
  {
    method: "post",
    path: "/api/v1/memories",
    schema: writeMemorySchema,
    description: "A memory record to create or update.",
    tags: tags.memories,
    operationId: "writeMemory",
    summary: "Create or update a memory",
    responses: noContentResponses,
  },
  {
    method: "post",
    path: "/api/v1/memories/touch-recalled",
    schema: touchRecalledSchema,
    description: "Memory ids to mark recalled.",
    tags: tags.memories,
    operationId: "touchRecalledMemories",
    summary: "Mark memories as recalled",
    responses: noContentResponses,
  },
  {
    method: "post",
    path: "/api/v1/memories/retire",
    schema: retireMemoriesSchema,
    description: "Memory ids and their retirement disposition.",
    tags: tags.memories,
    operationId: "retireMemories",
    summary: "Retire memories to the archive",
    responses: {
      ...successResponses,
      200: {
        description: "Retired memory ids",
        content: { "application/json": { schema: retireResultSchema } },
      },
    },
  },
  {
    method: "post",
    path: "/api/v1/memories/restore",
    schema: restoreMemoriesSchema,
    description: "Archived memory ids to restore.",
    tags: tags.memories,
    operationId: "restoreMemories",
    summary: "Restore memories from the archive",
    responses: {
      ...successResponses,
      200: { description: "Restored memories", content: { "application/json": { schema: memoryListResponseSchema } } },
    },
  },
  {
    method: "post",
    path: "/api/v1/memories/embeddings",
    schema: writeEmbeddingSchema,
    description: "An embedding to write.",
    tags: tags.embeddings,
    operationId: "writeEmbedding",
    summary: "Create or update an embedding",
    responses: noContentResponses,
  },
  {
    method: "post",
    path: "/api/v1/memories/embeddings/get",
    schema: getEmbeddingsSchema,
    description: "Embedding ids to retrieve.",
    tags: tags.embeddings,
    operationId: "getEmbeddings",
    summary: "Get embeddings by id",
    responses: {
      ...successResponses,
      200: { description: "Embeddings by id", content: { "application/json": { schema: embeddingsResultSchema } } },
    },
  },
  {
    method: "post",
    path: "/api/v1/memories/embeddings/search",
    schema: searchEmbeddingsSchema,
    description: "An embedding similarity query.",
    tags: tags.embeddings,
    operationId: "searchEmbeddings",
    summary: "Search memories by embedding similarity",
    responses: {
      ...successResponses,
      200: { description: "Matching memories", content: { "application/json": { schema: memoryListResponseSchema } } },
    },
  },
  {
    method: "post",
    path: "/api/v1/sessions",
    schema: saveSessionSchema,
    description: "A session to create or update.",
    tags: tags.sessions,
    operationId: "saveSession",
    summary: "Create or update a session",
    responses: noContentResponses,
  },
  {
    method: "put",
    path: "/api/v1/sessions/active",
    schema: setActiveSessionSchema,
    description: "The active session id.",
    tags: tags.sessions,
    operationId: "setActiveSession",
    summary: "Set the active session id",
    responses: noContentResponses,
  },
  {
    method: "patch",
    path: "/api/v1/sessions/{id}/append",
    schema: appendSessionSchema,
    description: "An incremental session update.",
    tags: tags.sessions,
    operationId: "appendSession",
    summary: "Append to a session",
    responses: appendResponses,
    params: idParams,
  },
  {
    method: "post",
    path: "/api/v1/sessions/{id}/search",
    schema: searchSessionSchema,
    description: "A session message query.",
    tags: tags.sessions,
    operationId: "searchSessionMessages",
    summary: "Search a session's messages",
    responses: {
      ...successResponses,
      200: {
        description: "Matching messages",
        content: { "application/json": { schema: sessionMessagesResponseSchema } },
      },
    },
    params: idParams,
  },
] as const) {
  app.openAPIRegistry.registerPath({
    method: route.method,
    path: route.path,
    tags: route.tags,
    security: bearerSecurity,
    operationId: route.operationId,
    summary: route.summary,
    request: {
      ...("params" in route ? { params: route.params } : {}),
      body: {
        content: { "application/json": { schema: route.schema } },
        description: route.description,
        required: true,
      },
    },
    responses: route.responses,
  });
}

for (const route of [
  {
    path: "/api/v1/memories",
    query: memoryListQuery,
    tags: tags.memories,
    operationId: "listMemories",
    summary: "List memories",
    responses: {
      200: { description: "Memories", content: { "application/json": { schema: memoryListResponseSchema } } },
      400: jsonError("Invalid kind"),
      ...unauthorized,
    },
  },
  {
    path: "/api/v1/memories/archive",
    query: listArchiveMemoriesSchema,
    tags: tags.memories,
    operationId: "listArchivedMemories",
    summary: "List archived memories",
    responses: {
      200: {
        description: "Archived memories",
        content: { "application/json": { schema: memoryArchiveListResponseSchema } },
      },
      ...invalidRequest,
    },
  },
  {
    path: "/api/v1/sessions",
    query: sessionListQuery,
    tags: tags.sessions,
    operationId: "listSessions",
    summary: "List sessions",
    responses: {
      200: { description: "Sessions", content: { "application/json": { schema: sessionListResponseSchema } } },
      ...unauthorized,
    },
  },
  {
    path: "/api/v1/sessions/active",
    tags: tags.sessions,
    operationId: "getActiveSession",
    summary: "Get the active session id",
    responses: {
      200: { description: "Active session id", content: { "application/json": { schema: activeSessionSchema } } },
      ...unauthorized,
    },
  },
  {
    path: "/api/v1/sessions/{id}",
    params: idParams,
    tags: tags.sessions,
    operationId: "getSession",
    summary: "Get a session by id",
    responses: {
      200: {
        description: "Session, or null if not found",
        content: { "application/json": { schema: sessionSchema.nullable() } },
      },
      ...unauthorized,
    },
  },
] as const) {
  app.openAPIRegistry.registerPath({
    method: "get",
    path: route.path,
    tags: route.tags,
    security: bearerSecurity,
    operationId: route.operationId,
    summary: route.summary,
    request: {
      ...("query" in route ? { query: route.query } : {}),
      ...("params" in route ? { params: route.params } : {}),
    },
    responses: route.responses,
  });
}

export { app };
export default app;
