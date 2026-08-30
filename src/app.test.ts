import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), verifyAuth: vi.fn() }));

vi.mock("./auth.js", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("./db.js", () => ({ getDb: () => mocks.sql }));

import { app } from "./app.js";

const archiveRecord = {
  id: "mem_old",
  scopeKey: "user:1",
  kind: "stored",
  content: "old fact",
  createdAt: "2026-01-01T00:00:00.000Z",
  tokenEstimate: 2,
  retiredAt: "2026-01-02T00:00:00.000Z",
  disposition: { kind: "superseded", by: ["mem_new"] },
};

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.verifyAuth.mockReset().mockResolvedValue({ ok: true, ownerId: "owner_1" });
});

describe("public API", () => {
  test("serves the landing page at root", async () => {
    const response = await app.request("https://cloud.example/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("<title>Acolyte Cloud</title>");
    expect(body).toContain("<span>acolyte</span>");
    expect(body).toContain('rel="icon"');
  });

  test("serves an OpenAPI 3.0.3 document", async () => {
    const response = await app.request("https://cloud.example/api/doc");

    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document).toMatchObject({ openapi: "3.0.3", info: { title: "Acolyte Cloud API" } });
    expect(document.paths).toHaveProperty("/api/v1/memories");
    expect(document.paths["/api/v1/memories"].post.requestBody.content["application/json"].schema).toBeDefined();
    expect(document.paths["/api/v1/memories"].post.responses).not.toHaveProperty("200");
    expect(document.paths["/api/v1/sessions/{id}/append"].patch.parameters).toMatchObject([
      { in: "path", name: "id", required: true },
    ]);
    expect(document.paths["/api/v1/memories"].get.parameters).toMatchObject([
      { in: "query", name: "scopeKey" },
      { in: "query", name: "kind" },
    ]);
    expect(document.paths["/api/v1/sessions"].get.parameters).toMatchObject([{ in: "query", name: "limit" }]);
  });

  test("documents every JSON write request", async () => {
    const document = await (await app.request("https://cloud.example/api/doc")).json();
    const requests = [
      ["/api/v1/memories", "post"],
      ["/api/v1/memories/touch-recalled", "post"],
      ["/api/v1/memories/retire", "post"],
      ["/api/v1/memories/restore", "post"],
      ["/api/v1/memories/archive", "post"],
      ["/api/v1/memories/embeddings", "post"],
      ["/api/v1/memories/embeddings/get", "post"],
      ["/api/v1/memories/embeddings/search", "post"],
      ["/api/v1/sessions", "post"],
      ["/api/v1/sessions/active", "put"],
      ["/api/v1/sessions/{id}/append", "patch"],
      ["/api/v1/sessions/{id}/search", "post"],
    ] as const;

    for (const [path, method] of requests)
      expect(document.paths[path][method]).toMatchObject({
        requestBody: { content: { "application/json": { schema: expect.anything() } } },
        responses: { 401: { description: "Unauthorized" } },
      });
  });

  test("documents metadata for discovery and codegen", async () => {
    const document = await (await app.request("https://cloud.example/api/doc")).json();

    expect(document.servers).toEqual([{ url: "https://cloud.acolyte.sh", description: "Production" }]);
    expect(document.tags.map((tag: { name: string }) => tag.name)).toEqual([
      "System",
      "Memories",
      "Embeddings",
      "Sessions",
    ]);
    for (const [path, methods] of Object.entries<Record<string, unknown>>(document.paths))
      for (const [method, operation] of Object.entries(methods as Record<string, { operationId?: string }>))
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
  });

  test("documents response bodies for reads that return one", async () => {
    const document = await (await app.request("https://cloud.example/api/doc")).json();
    const reads = [
      ["/api/v1/memories", "get", "MemoryList"],
      ["/api/v1/memories/archive", "get", "MemoryArchiveList"],
      ["/api/v1/memories/retire", "post", "RetireResult"],
      ["/api/v1/memories/restore", "post", "MemoryList"],
      ["/api/v1/memories/embeddings/get", "post", "EmbeddingsResult"],
      ["/api/v1/memories/embeddings/search", "post", "MemoryList"],
      ["/api/v1/sessions", "get", "SessionList"],
      ["/api/v1/sessions/active", "get", "ActiveSession"],
      ["/api/v1/sessions/{id}/search", "post", "SessionMessages"],
    ] as const;

    for (const [path, method, schemaName] of reads)
      expect(document.paths[path][method].responses["200"].content["application/json"].schema).toEqual({
        $ref: `#/components/schemas/${schemaName}`,
      });

    expect(document.paths["/api/v1/sessions/{id}"].get.responses["200"].content["application/json"].schema).toEqual({
      allOf: [{ $ref: "#/components/schemas/Session" }, { nullable: true }],
    });
  });

  test("documents the 401 shape verifyAuth actually returns", async () => {
    const document = await (await app.request("https://cloud.example/api/doc")).json();

    expect(document.paths["/api/v1/sessions"].get.responses["401"]).toMatchObject({
      content: { "text/plain": { schema: { type: "string" } } },
    });
  });

  test("serves Scalar API reference", async () => {
    const response = await app.request("https://cloud.example/api/reference");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Acolyte Cloud API reference");
    expect(html).toContain("@scalar/api-reference@1.63.0");
  });

  test("writes a gzip JSON memory request with the existing response", async () => {
    const compressed = new Blob([
      JSON.stringify({
        record: {
          id: "mem_1",
          scopeKey: "user:1",
          kind: "stored",
          content: "fact",
          createdAt: "2026-01-01",
          tokenEstimate: 1,
        },
      }),
    ])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    mocks.sql.mockResolvedValue([]);

    const response = await app.request(
      new Request("https://cloud.example/api/v1/memories", {
        method: "POST",
        body: compressed,
        duplex: "half",
        headers: { "content-encoding": "gzip", "content-type": "application/json" },
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(204);
    expect(mocks.sql).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO memories"),
      expect.arrayContaining(["mem_1", "owner_1"]),
    );
  });

  test("rejects invalid input with a per-field message, never the raw ZodError object", async () => {
    const response = await app.request("https://cloud.example/api/v1/memories", {
      method: "POST",
      body: JSON.stringify({ record: { id: "", kind: "bogus" } }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(body.error).toContain("observation");
    expect(body.error).not.toContain("Zod");
    expect(body.error).not.toContain("issues");
  });

  test("keeps unauthorized API errors", async () => {
    mocks.verifyAuth.mockResolvedValue({ ok: false, error: new Response("Unauthorized", { status: 401 }) });

    const response = await app.request("https://cloud.example/api/v1/sessions");

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  test("authenticates unsupported API methods", async () => {
    mocks.verifyAuth.mockResolvedValue({ ok: false, error: new Response("Unauthorized", { status: 401 }) });

    const response = await app.request("https://cloud.example/api/v1/sessions", { method: "DELETE" });

    expect(response.status).toBe(401);
  });

  test("retires owner memories and embeddings atomically", async () => {
    mocks.sql.mockResolvedValue([{ id: "mem_old" }]);

    const response = await app.request("https://cloud.example/api/v1/memories/retire", {
      method: "POST",
      body: JSON.stringify({ ids: ["mem_old"], disposition: { kind: "superseded", by: ["mem_new"] } }),
    });

    expect(await response.json()).toEqual({ retired: ["mem_old"] });
    expect(mocks.sql.mock.calls[0][0]).toContain("deleted_embeddings");
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", ["mem_old"], "superseded", '["mem_new"]']);
  });

  test("lists archive records with owner-scoped filters", async () => {
    mocks.sql.mockResolvedValue([
      {
        id: "mem_old",
        scopeKey: "user:1",
        disposition: "superseded",
        supersededBy: ["mem_new"],
      },
    ]);

    const response = await app.request(
      "https://cloud.example/api/v1/memories/archive?scopeKey=user%3A1&disposition=superseded",
    );

    expect(await response.json()).toMatchObject([{ disposition: { kind: "superseded", by: ["mem_new"] } }]);
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", "user:1", "superseded"]);
  });

  test("repeating a retirement overwrites the archive record instead of failing", async () => {
    mocks.sql.mockResolvedValue([{ id: "mem_old" }]);

    await app.request("https://cloud.example/api/v1/memories/retire", {
      method: "POST",
      body: JSON.stringify({ ids: ["mem_old"], disposition: { kind: "noise" } }),
    });

    expect(mocks.sql.mock.calls[0][0]).toContain("ON CONFLICT (owner_id, id) DO UPDATE");
  });

  test("writes an archive record with the caller's retirement time and disposition", async () => {
    mocks.sql.mockResolvedValue([]);

    const response = await app.request("https://cloud.example/api/v1/memories/archive", {
      method: "POST",
      body: JSON.stringify({ record: archiveRecord }),
    });

    expect(response.status).toBe(204);
    expect(mocks.sql.mock.calls[0][1]).toEqual([
      "mem_old",
      "owner_1",
      "user:1",
      "stored",
      "old fact",
      2,
      "2026-01-01T00:00:00.000Z",
      null,
      null,
      "2026-01-02T00:00:00.000Z",
      "superseded",
      '["mem_new"]',
    ]);
  });

  test("an archive write drops any live copy of the record and its embedding", async () => {
    mocks.sql.mockResolvedValue([]);

    await app.request("https://cloud.example/api/v1/memories/archive", {
      method: "POST",
      body: JSON.stringify({ record: archiveRecord }),
    });

    const sql = mocks.sql.mock.calls[0][0];
    expect(sql).toContain("DELETE FROM memories");
    expect(sql).toContain("DELETE FROM memory_embeddings");
    expect(sql).toContain("ON CONFLICT (owner_id, id) DO UPDATE");
  });

  test("repeating an archive write stores the latest values", async () => {
    mocks.sql.mockResolvedValue([]);

    const first = await app.request("https://cloud.example/api/v1/memories/archive", {
      method: "POST",
      body: JSON.stringify({ record: archiveRecord }),
    });
    const second = await app.request("https://cloud.example/api/v1/memories/archive", {
      method: "POST",
      body: JSON.stringify({
        record: { ...archiveRecord, content: "corrected fact", disposition: { kind: "noise" } },
      }),
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(mocks.sql.mock.calls[1][1]).toEqual([
      "mem_old",
      "owner_1",
      "user:1",
      "stored",
      "corrected fact",
      2,
      "2026-01-01T00:00:00.000Z",
      null,
      null,
      "2026-01-02T00:00:00.000Z",
      "noise",
      null,
    ]);
  });

  test("rejects an archive write with no retirement time", async () => {
    const { retiredAt, ...withoutRetiredAt } = archiveRecord;

    const response = await app.request("https://cloud.example/api/v1/memories/archive", {
      method: "POST",
      body: JSON.stringify({ record: withoutRetiredAt }),
    });

    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  test("restores only archive records owned by the caller", async () => {
    mocks.sql.mockResolvedValue([{ id: "mem_old", scopeKey: "user:1", kind: "stored", content: "old fact" }]);

    const response = await app.request("https://cloud.example/api/v1/memories/restore", {
      method: "POST",
      body: JSON.stringify({ ids: ["mem_old"] }),
    });

    expect(await response.json()).toEqual([{ id: "mem_old", scopeKey: "user:1", kind: "stored", content: "old fact" }]);
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", ["mem_old"]]);
  });
});

describe("error handling", () => {
  test("returns a JSON 404 for an unrecognized path", async () => {
    const response = await app.request("https://cloud.example/totally/bogus/path");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found", requestId: response.headers.get("x-request-id") });
  });

  test("returns a JSON 500 and does not leak internals when a handler throws", async () => {
    mocks.sql.mockRejectedValue(new Error("connection reset"));

    const response = await app.request("https://cloud.example/api/v1/sessions");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Internal server error",
      requestId: response.headers.get("x-request-id"),
    });
  });

  test("stamps every response with a request id", async () => {
    const response = await app.request("https://cloud.example/api/health");

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
