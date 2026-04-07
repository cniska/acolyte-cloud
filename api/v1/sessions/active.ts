import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { setActiveSessionSchema } from "../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const sql = getDb();

  if (req.method === "GET") {
    const rows = await sql(
      "SELECT session_id FROM active_sessions WHERE owner_id = $1",
      [auth.ownerId],
    );
    return Response.json({ id: (rows[0]?.session_id as string) ?? null });
  }

  if (req.method === "PUT") {
    const parsed = setActiveSessionSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
    const { id } = parsed.data;
    await sql(
      `INSERT INTO active_sessions (owner_id, session_id) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET session_id = EXCLUDED.session_id`,
      [auth.ownerId, id],
    );
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
