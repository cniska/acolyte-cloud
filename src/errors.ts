import type { Context } from "hono";
import type { AppEnv } from "./observability.js";

export function notFound(c: Context<AppEnv>) {
  return c.json({ error: "Not found", requestId: c.get("requestId") }, 404);
}

export function onError(err: Error, c: Context<AppEnv>) {
  console.error(
    JSON.stringify({ level: "error", requestId: c.get("requestId"), message: err.message, stack: err.stack }),
  );
  return c.json({ error: "Internal server error", requestId: c.get("requestId") }, 500);
}

/** Joins each issue's own message, never the raw ZodError object or its internal path/structure. */
export function invalidRequestMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export function validationHook(
  result: { success: true } | { success: false; error: { issues: { message: string }[] } },
  c: Context<AppEnv>,
) {
  if (!result.success)
    return c.json({ error: invalidRequestMessage(result.error), requestId: c.get("requestId") }, 400);
}
