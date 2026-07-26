import { verifyAuth } from "../../../src/auth.js";
import { getDb } from "../../../src/db.js";
import { listArchiveMemoriesSchema } from "@acolyte/cloud-contract";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await verifyAuth(req);
  if (!auth.ok) return auth.error;
  const url = new URL(req.url);
  const parsed = listArchiveMemoriesSchema.safeParse({
    scopeKey: url.searchParams.get("scopeKey") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    disposition: url.searchParams.get("disposition") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const conditions = ["owner_id = $1"];
  const params: unknown[] = [auth.ownerId];
  for (const [column, value] of Object.entries(parsed.data)) {
    if (value) {
      conditions.push(`${column === "scopeKey" ? "scope_key" : column} = $${params.length + 1}`);
      params.push(value);
    }
  }

  const sql = getDb();
  const rows = await sql(
    `SELECT id, scope_key AS "scopeKey", kind, content, token_estimate AS "tokenEstimate", created_at AS "createdAt",
             last_recalled_at AS "lastRecalledAt", topic, retired_at AS "retiredAt", disposition, superseded_by AS "supersededBy"
     FROM memory_archive WHERE ${conditions.join(" AND ")} ORDER BY retired_at DESC`,
    params,
  );
  return Response.json(
    rows.map(({ disposition, supersededBy, ...record }) => ({
      ...record,
      disposition: disposition === "superseded" ? { kind: disposition, by: supersededBy } : { kind: disposition },
    })),
  );
}
