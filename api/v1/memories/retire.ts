import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { parseJson } from "../../../src/parse.js";
import { retireMemoriesSchema } from "@acolyte/cloud-contract";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;
  const body = await parseJson(req);
  const parsed = retireMemoriesSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { ids, disposition } = parsed.data;
  const sql = getDb();
  const rows = await sql(
    `WITH moved AS (
       DELETE FROM memories WHERE owner_id = $1 AND id = ANY($2) RETURNING *
     ), archived AS (
       INSERT INTO memory_archive (id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic, disposition, superseded_by)
       SELECT id, owner_id, scope_key, kind, content, token_estimate, created_at, last_recalled_at, topic, $3, $4 FROM moved
       RETURNING id
     ), deleted_embeddings AS (
       DELETE FROM memory_embeddings WHERE owner_id = $1 AND id IN (SELECT id FROM moved)
     ) SELECT id FROM archived`,
    [auth.ownerId, ids, disposition.kind, disposition.kind === "superseded" ? JSON.stringify(disposition.by) : null],
  );
  return Response.json({ retired: rows.map((row) => row.id) });
}
