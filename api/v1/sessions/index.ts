import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { stripNulls } from "../../../src/json.js";
import { parseJson } from "../../../src/parse.js";
import { saveSessionSchema } from "../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;
  const { ownerId } = auth;
  const sql = getDb();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const rows = await sql(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", model, title,
              workspace, workspace_name AS "workspaceName", workspace_branch AS "workspaceBranch",
              messages, token_usage AS "tokenUsage"
       FROM sessions WHERE owner_id = $1
       ORDER BY updated_at DESC LIMIT $2`,
      [ownerId, limit],
    );
    return Response.json(rows.map(stripNulls));
  }

  if (req.method === "POST") {
    const body = await parseJson(req);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    const parsed = saveSessionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
    const session = parsed.data;
    await sql(
      `INSERT INTO sessions (id, owner_id, created_at, updated_at, model, title, workspace, workspace_name, workspace_branch, messages, token_usage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (owner_id, id) DO UPDATE SET
         updated_at = EXCLUDED.updated_at, model = EXCLUDED.model, title = EXCLUDED.title,
         workspace = EXCLUDED.workspace, workspace_name = EXCLUDED.workspace_name,
         workspace_branch = EXCLUDED.workspace_branch, messages = EXCLUDED.messages,
         token_usage = EXCLUDED.token_usage`,
      [session.id, ownerId, session.createdAt, session.updatedAt, session.model, session.title, session.workspace ?? null, session.workspaceName ?? null, session.workspaceBranch ?? null, JSON.stringify(session.messages), JSON.stringify(session.tokenUsage)],
    );
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
