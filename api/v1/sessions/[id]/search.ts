import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { extractParentId, parseJson } from "../../../../src/parse.js";
import { searchSessionSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const body = await parseJson(req);
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const parsed = searchSessionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const id = extractParentId(req);
  const { query, limit } = parsed.data;
  const sql = getDb();

  const rows = await sql(
    `SELECT m.value
     FROM sessions s, jsonb_array_elements(s.messages) AS m
     WHERE s.owner_id = $1 AND s.id = $2
       AND m.value->>'kind' IS DISTINCT FROM 'status'
       AND m.value->>'content' ILIKE '%' || $3 || '%'
     LIMIT $4`,
    [auth.ownerId, id, query, limit ?? 10],
  );

  return Response.json(rows.map((r) => r.value));
}
