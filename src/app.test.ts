import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), verifyAuth: vi.fn() }));

vi.mock("./auth.js", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("./db.js", () => ({ getDb: () => mocks.sql }));

import { app } from "./app.js";

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.verifyAuth.mockReset().mockResolvedValue({ ok: true, ownerId: "owner_1" });
});

describe("public API", () => {
  test("keeps the public landing page", async () => {
    const landing = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    expect(landing).toContain("<title>Acolyte Cloud</title>");
    expect(landing).toContain("<span>acolyte</span>");
  });

  test("serves an OpenAPI 3.0.3 document", async () => {
    const response = await app.request("https://cloud.example/api/doc");

    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document).toMatchObject({ openapi: "3.0.3", info: { title: "Acolyte Cloud API" } });
    expect(document.paths).toHaveProperty("/api/v1/memories");
    expect(document.paths["/api/v1/memories"].post.requestBody.content["application/json"].schema).toBeDefined();
  });

  test("serves Scalar API reference", async () => {
    const response = await app.request("https://cloud.example/api/reference");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Acolyte Cloud API reference");
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

  test("keeps unauthorized API errors", async () => {
    mocks.verifyAuth.mockResolvedValue({ ok: false, error: new Response("Unauthorized", { status: 401 }) });

    const response = await app.request("https://cloud.example/api/v1/sessions");

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
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
