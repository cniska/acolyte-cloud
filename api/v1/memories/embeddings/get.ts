import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";
import { getEmbeddingsSchema } from "../../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const parsed = getEmbeddingsSchema.safeParse(await req.json());
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
    const floats = JSON.parse(row.embedding as string) as number[];
    const buf = Buffer.alloc(floats.length * 4);
    for (let i = 0; i < floats.length; i++) buf.writeFloatLE(floats[i], i * 4);
    embeddings[row.id as string] = buf.toString("base64");
  }
  return Response.json({ embeddings });
}
