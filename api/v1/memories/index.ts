import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export const config = { runtime: "edge" };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });
  const { ownerId } = auth;
  const sql = getDb();

  if (req.method === "GET") {
    const { scopeKey, kind } = req.query;
    const conditions = ["owner_id = $1"];
    const params: unknown[] = [ownerId];

    if (typeof scopeKey === "string") {
      conditions.push(`scope_key = $${params.length + 1}`);
      params.push(scopeKey);
    }
    if (typeof kind === "string") {
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
    return res.json(rows);
  }

  if (req.method === "POST") {
    const { record } = req.body;
    await sql(
      `INSERT INTO memories (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (owner_id, id) DO UPDATE SET
         scope_key = EXCLUDED.scope_key, kind = EXCLUDED.kind, content = EXCLUDED.content,
         token_estimate = EXCLUDED.token_estimate, last_recalled_at = EXCLUDED.last_recalled_at`,
      [record.id, ownerId, record.scopeKey, record.kind, record.content, record.tokenEstimate, record.createdAt, record.lastRecalledAt ?? null],
    );
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
