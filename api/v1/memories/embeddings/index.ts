import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { writeEmbeddingSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const parsed = writeEmbeddingSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { id, scopeKey, embedding } = parsed.data;

  const binary = Buffer.from(embedding, "base64");
  const floats = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
  const pgVector = `[${Array.from(floats).join(",")}]`;

  const sql = getDb();
  await sql(
    `INSERT INTO memory_embeddings (id, owner_id, scope_key, embedding)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, id) DO UPDATE SET scope_key = EXCLUDED.scope_key, embedding = EXCLUDED.embedding`,
    [id, auth.ownerId, scopeKey, pgVector],
  );
  return new Response(null, { status: 204 });
}
