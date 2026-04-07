import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { base64ToVector, parseJson } from "../../../../src/parse.js";
import { writeEmbeddingSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const body = await parseJson(req);
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const parsed = writeEmbeddingSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { id, scopeKey, embedding } = parsed.data;

  const pgVector = base64ToVector(embedding);
  if (!pgVector) return Response.json({ error: "Invalid embedding" }, { status: 400 });

  const sql = getDb();
  await sql(
    `INSERT INTO memory_embeddings (id, owner_id, scope_key, embedding)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, id) DO UPDATE SET scope_key = EXCLUDED.scope_key, embedding = EXCLUDED.embedding`,
    [id, auth.ownerId, scopeKey, pgVector],
  );
  return new Response(null, { status: 204 });
}
