export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function error(message: string, status: number): Response {
  return new Response(message, { status });
}

export function methodNotAllowed(): Response {
  return error("Method not allowed", 405);
}
