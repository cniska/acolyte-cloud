import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(204).end();

  const sql = getDb();
  const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  await sql(
    `UPDATE memories SET last_recalled_at = now() WHERE owner_id = $1 AND id IN (${placeholders})`,
    [auth.ownerId, ...ids],
  );
  return res.status(204).end();
}
