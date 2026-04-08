import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { stripNulls } from "../../../src/json.js";
import { extractId } from "../../../src/parse.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const id = extractId(req);
  const sql = getDb();

  if (req.method === "GET") {
    const rows = await sql(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title,
              workspace, workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch",
              messages, token_usage AS "tokenUsage"
       FROM sessions WHERE owner_id = $1 AND id = $2`,
      [auth.ownerId, id],
    );
    const row = rows[0];
    return Response.json(row ? stripNulls(row) : null);
  }

  if (req.method === "DELETE") {
    await sql("DELETE FROM sessions WHERE owner_id = $1 AND id = $2", [auth.ownerId, id]);
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
