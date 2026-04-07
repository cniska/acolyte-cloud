import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const id = req.query.id as string;
  const sql = getDb();
  await sql("DELETE FROM memories WHERE owner_id = $1 AND id = $2", [auth.ownerId, id]);
  return res.status(204).end();
}
