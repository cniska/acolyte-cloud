import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { parseJson } from "../../../src/parse.js";
import { restoreMemoriesSchema } from "@acolyte/cloud-contract";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;
  const body = await parseJson(req);
  const parsed = restoreMemoriesSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const sql = getDb();
  const rows = await sql(
    `WITH restored AS (
       DELETE FROM memory_archive WHERE owner_id = $1 AND id = ANY($2) RETURNING *
     ), inserted AS (
       INSERT INTO memories (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic)
       SELECT id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic FROM restored
       RETURNING id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate", created_at AS "createdAt", last_recalled_at AS "lastRecalledAt", topic
     ) SELECT * FROM inserted`,
    [auth.ownerId, parsed.data.ids],
  );
  return Response.json(rows);
}
