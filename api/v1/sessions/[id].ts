import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const id = req.query.id as string;
  const sql = getDb();

  if (req.method === "GET") {
    const rows = await sql(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title,
              workspace, workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch",
              messages, token_usage AS "tokenUsage"
       FROM sessions WHERE owner_id = $1 AND id = $2`,
      [auth.ownerId, id],
    );
    return res.json(rows[0] ?? null);
  }

  if (req.method === "DELETE") {
    await sql("DELETE FROM sessions WHERE owner_id = $1 AND id = $2", [auth.ownerId, id]);
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
