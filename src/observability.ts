import type { MiddlewareHandler } from "hono";

export type AppEnv = { Variables: { requestId: string } };

export const observability: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  const start = Date.now();
  await next();
  c.header("x-request-id", requestId);
  console.log(
    JSON.stringify({
      level: "info",
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - start,
    }),
  );
};
