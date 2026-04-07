import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });
  const { ownerId } = auth;
  const sql = getDb();

  if (req.method === "GET") {
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
    const rows = await sql(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title,
              workspace, workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch",
              messages, token_usage AS "tokenUsage"
       FROM sessions WHERE owner_id = $1
       ORDER BY updated_at DESC LIMIT $2`,
      [ownerId, limit],
    );
    return res.json(rows);
  }

  if (req.method === "POST") {
    const s = req.body;
    await sql(
      `INSERT INTO sessions (id, owner_id, created_at, updated_at, model, title, workspace, workspace_name, workspace_branch, messages, token_usage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (owner_id, id) DO UPDATE SET
         updated_at = EXCLUDED.updated_at, model = EXCLUDED.model, title = EXCLUDED.title,
         workspace = EXCLUDED.workspace, workspace_name = EXCLUDED.workspace_name,
         workspace_branch = EXCLUDED.workspace_branch, messages = EXCLUDED.messages,
         token_usage = EXCLUDED.token_usage`,
      [s.id, ownerId, s.createdAt, s.updatedAt, s.model, s.title, s.workspace ?? null, s.workspaceName ?? null, s.workspaceBranch ?? null, JSON.stringify(s.messages), JSON.stringify(s.tokenUsage)],
    );
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
