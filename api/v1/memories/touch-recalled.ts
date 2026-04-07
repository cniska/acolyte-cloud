import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { touchRecalledSchema } from "../../../src/schemas.js";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;

  const parsed = touchRecalledSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const { ids } = parsed.data;

  const sql = getDb();
  const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  await sql(
    `UPDATE memories SET last_recalled_at = now() WHERE owner_id = $1 AND id IN (${placeholders})`,
    [auth.ownerId, ...ids],
  );
  return new Response(null, { status: 204 });
}
