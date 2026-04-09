import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { stripNulls } from "../../../src/json.js";
import { extractId, parseJson } from "../../../src/parse.js";
import { appendSessionSchema } from "../../../src/schemas.js";

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

  if (req.method === "PATCH") {
    const body = await parseJson(req);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    const parsed = appendSessionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
    const { messages, tokenUsage, updatedAt, model, title, workspace, workspaceName, workspaceBranch } = parsed.data;

    const sets: string[] = ["updated_at = $3"];
    const params: unknown[] = [auth.ownerId, id, updatedAt];
    let idx = 4;

    if (messages) {
      sets.push(`messages = messages || $${idx}::jsonb`);
      params.push(JSON.stringify(messages));
      idx++;
    }
    if (tokenUsage) {
      sets.push(`token_usage = token_usage || $${idx}::jsonb`);
      params.push(JSON.stringify(tokenUsage));
      idx++;
    }
    if (model !== undefined) {
      sets.push(`model = $${idx}`);
      params.push(model);
      idx++;
    }
    if (title !== undefined) {
      sets.push(`title = $${idx}`);
      params.push(title);
      idx++;
    }
    if (workspace !== undefined) {
      sets.push(`workspace = $${idx}`);
      params.push(workspace);
      idx++;
    }
    if (workspaceName !== undefined) {
      sets.push(`workspace_name = $${idx}`);
      params.push(workspaceName);
      idx++;
    }
    if (workspaceBranch !== undefined) {
      sets.push(`workspace_branch = $${idx}`);
      params.push(workspaceBranch);
      idx++;
    }

    const result = await sql(
      `UPDATE sessions SET ${sets.join(", ")} WHERE owner_id = $1 AND id = $2 RETURNING id`,
      params,
    );

    if (result.length === 0) return Response.json({ error: "Session not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  }

  if (req.method === "DELETE") {
    await sql("DELETE FROM sessions WHERE owner_id = $1 AND id = $2", [auth.ownerId, id]);
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
