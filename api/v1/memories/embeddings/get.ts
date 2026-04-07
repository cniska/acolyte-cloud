import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ embeddings: {} });

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
  return res.json({ embeddings });
}
