import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await verifyAuth(req as unknown as Request);
  if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

  const sql = getDb();

  if (req.method === "GET") {
    const rows = await sql(
      "SELECT session_id FROM active_sessions WHERE owner_id = $1",
      [auth.ownerId],
    );
    return res.json({ id: (rows[0]?.session_id as string) ?? null });
  }

  if (req.method === "PUT") {
    const { id } = req.body;
    await sql(
      `INSERT INTO active_sessions (owner_id, session_id) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [auth.ownerId, id],
    );
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
