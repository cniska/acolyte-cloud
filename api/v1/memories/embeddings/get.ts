import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { parseJson, vectorToBase64 } from "../../../../src/parse.js";
import { getEmbeddingsSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const body = await parseJson(req);
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const parsed = getEmbeddingsSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { ids } = parsed.data;
  if (ids.length === 0) return Response.json({ embeddings: {} });

  const sql = getDb();
  const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  const rows = await sql(
    `SELECT id, embedding::text FROM memory_embeddings WHERE owner_id = $1 AND id IN (${placeholders})`,
    [auth.ownerId, ...ids],
  );

  const embeddings: Record<string, string> = {};
  for (const row of rows) {
    embeddings[row.id as string] = vectorToBase64(row.embedding as string);
  }
  return Response.json({ embeddings });
}
