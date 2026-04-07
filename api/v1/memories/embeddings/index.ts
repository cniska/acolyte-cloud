import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const { id, scopeKey, embedding } = req.body;
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
  return res.status(204).end();
}
