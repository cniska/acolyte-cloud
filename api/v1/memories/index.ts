import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { parseJson } from "../../../src/parse.js";
import { writeMemorySchema } from "../../../src/schemas.js";

export const config = { runtime: "edge" };

const VALID_KINDS = new Set(["observation", "stored"]);

export default async function handler(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;
  const { ownerId } = auth;
  const sql = getDb();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const scopeKey = url.searchParams.get("scopeKey");
    const kind = url.searchParams.get("kind");
    if (kind && !VALID_KINDS.has(kind)) return Response.json({ error: "Invalid kind" }, { status: 400 });

    const conditions = ["owner_id = $1"];
    const params: unknown[] = [ownerId];

    if (scopeKey) {
      conditions.push(`scope_key = $${params.length + 1}`);
      params.push(scopeKey);
    }
    if (kind) {
      conditions.push(`kind = $${params.length + 1}`);
      params.push(kind);
    }

    const rows = await sql(
      `SELECT id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate",
              created_at AS "createdAt", last_recalled_at AS "lastRecalledAt"
       FROM memories WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC`,
      params,
    );
    return Response.json(rows);
  }

  if (req.method === "POST") {
    const body = await parseJson(req);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    const parsed = writeMemorySchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
    const { record } = parsed.data;
    await sql(
      `INSERT INTO memories (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (owner_id, id) DO UPDATE SET
         scope_key = EXCLUDED.scope_key, kind = EXCLUDED.kind, content = EXCLUDED.content,
         token_estimate = EXCLUDED.token_estimate, last_recalled_at = EXCLUDED.last_recalled_at`,
      [record.id, ownerId, record.scopeKey, record.kind, record.content, record.tokenEstimate, record.createdAt, record.lastRecalledAt ?? null],
    );
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
