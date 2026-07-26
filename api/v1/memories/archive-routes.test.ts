import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  verifyAuth: vi.fn(),
}));

vi.mock("../../../src/auth.js", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("../../../src/db.js", () => ({ getDb: () => mocks.sql }));

import archive from "./archive.js";
import restore from "./restore.js";
import retire from "./retire.js";

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.verifyAuth.mockReset().mockResolvedValue({ ok: true, ownerId: "owner_1" });
});

describe("retire", () => {
  test("moves owner records and embeddings atomically", async () => {
    mocks.sql.mockResolvedValue([{ id: "mem_old" }]);

    const response = await retire(
      new Request("https://cloud.example/api/v1/memories/retire", {
        method: "POST",
        body: JSON.stringify({ ids: ["mem_old"], disposition: { kind: "superseded", by: ["mem_new"] } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ retired: ["mem_old"] });
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.sql.mock.calls[0][0]).toContain("deleted_embeddings");
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", ["mem_old"], "superseded", '["mem_new"]']);
  });
});

describe("archive", () => {
  test("returns owner archive records with validated filters", async () => {
    mocks.sql.mockResolvedValue([
      {
        id: "mem_old",
        scopeKey: "user:1",
        kind: "stored",
        content: "old fact",
        createdAt: "2026-01-01T00:00:00.000Z",
        tokenEstimate: 2,
        lastRecalledAt: null,
        topic: null,
        retiredAt: "2026-01-02T00:00:00.000Z",
        disposition: "superseded",
        supersededBy: ["mem_new"],
      },
    ]);

    const response = await archive(
      new Request("https://cloud.example/api/v1/memories/archive?scopeKey=user%3A1&disposition=superseded"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ disposition: { kind: "superseded", by: ["mem_new"] } }]);
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", "user:1", "superseded"]);
  });

  test("rejects invalid filters", async () => {
    const response = await archive(new Request("https://cloud.example/api/v1/memories/archive?disposition=unknown"));

    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});

describe("restore", () => {
  test("returns only records restored for the owner", async () => {
    mocks.sql.mockResolvedValue([{ id: "mem_old", scopeKey: "user:1", kind: "stored", content: "old fact" }]);

    const response = await restore(
      new Request("https://cloud.example/api/v1/memories/restore", {
        method: "POST",
        body: JSON.stringify({ ids: ["mem_old"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "mem_old", scopeKey: "user:1", kind: "stored", content: "old fact" }]);
    expect(mocks.sql.mock.calls[0][1]).toEqual(["owner_1", ["mem_old"]]);
  });
});
