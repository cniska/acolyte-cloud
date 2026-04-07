import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../../src/auth.js";
import { getDb } from "../../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const { queryEmbedding, scopeKey, kind, limit } = req.body;
  const binary = Buffer.from(queryEmbedding, "base64");
  const floats = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
  const pgVector = `[${Array.from(floats).join(",")}]`;

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
  params.push(limit ?? 10);

  const sql = getDb();
  const rows = await sql(
    `SELECT m.id, m.scope_key AS "scopeKey", m.kind, m.content, m.token_estimate AS "tokenEstimate",
            m.created_at AS "createdAt", m.last_recalled_at AS "lastRecalledAt"
     FROM memory_embeddings e
     JOIN memories m ON m.owner_id = e.owner_id AND m.id = e.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.embedding <=> ${vectorParam}::vector
     LIMIT ${limitParam}`,
    params,
  );
  return res.json(rows);
}
