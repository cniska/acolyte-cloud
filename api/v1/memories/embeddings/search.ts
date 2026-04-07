import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { base64ToVector, parseJson } from "../../../../src/parse.js";
import { searchEmbeddingsSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const body = await parseJson(req);
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const parsed = searchEmbeddingsSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { queryEmbedding, scopeKey, kind, limit } = parsed.data;

  const pgVector = base64ToVector(queryEmbedding);
  if (!pgVector) return Response.json({ error: "Invalid embedding" }, { status: 400 });

  const conditions = ["e.owner_id = $1"];
  const params: unknown[] = [auth.ownerId];

  if (scopeKey) {
    conditions.push(`e.scope_key = $${params.length + 1}`);
    params.push(scopeKey);
  }
  if (kind) {
    conditions.push(`m.kind = $${params.length + 1}`);
    params.push(kind);
  }

  const vectorParam = `$${params.length + 1}`;
  params.push(pgVector);

  const limitParam = `$${params.length + 1}`;
  params.push(limit);

  const sql = getDb();
  const rows = await sql(
    `SELECT m.id, m.scope_key AS "scopeKey", m.kind, m.content, m.token_estimate AS "tokenEstimate",
            m.created_at AS "createdAt", m.last_recalled_at AS "lastRecalledAt", m.topic
     FROM memory_embeddings e
     JOIN memories m ON m.owner_id = e.owner_id AND m.id = e.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.embedding <=> ${vectorParam}::vector
     LIMIT ${limitParam}`,
    params,
  );
  return Response.json(rows);
}
