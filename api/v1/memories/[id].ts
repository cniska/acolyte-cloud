import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { extractId } from "../../../src/parse.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "DELETE") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const id = extractId(req);
  const sql = getDb();
  await sql("DELETE FROM memories WHERE owner_id = $1 AND id = $2", [auth.ownerId, id]);
  return new Response(null, { status: 204 });
}
