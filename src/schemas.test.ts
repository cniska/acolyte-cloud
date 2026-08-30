import { describe, expect, test } from "vitest";
import {
  getEmbeddingsSchema,
  listArchiveMemoriesSchema,
  memoryArchiveRecordSchema,
  saveSessionSchema,
  searchEmbeddingsSchema,
  setActiveSessionSchema,
  touchRecalledSchema,
  retireMemoriesSchema,
  restoreMemoriesSchema,
  writeArchiveMemorySchema,
  writeEmbeddingSchema,
  writeMemorySchema,
} from "@acolyte/cloud-contract";

describe("writeMemorySchema", () => {
  const valid = {
    record: {
      id: "mem_abc",
      scopeKey: "user_1",
      kind: "stored" as const,
      content: "hello",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 3,
      lastRecalledAt: null,
    },
  };

  test("accepts valid input", () => {
    expect(writeMemorySchema.safeParse(valid).success).toBe(true);
  });

  test("accepts with optional scope", () => {
    expect(writeMemorySchema.safeParse({ ...valid, scope: "user" }).success).toBe(true);
  });

  test("rejects invalid kind", () => {
    const input = { record: { ...valid.record, kind: "invalid" } };
    expect(writeMemorySchema.safeParse(input).success).toBe(false);
  });

  test("rejects empty content", () => {
    const input = { record: { ...valid.record, content: "" } };
    expect(writeMemorySchema.safeParse(input).success).toBe(false);
  });

  test("rejects negative tokenEstimate", () => {
    const input = { record: { ...valid.record, tokenEstimate: -1 } };
    expect(writeMemorySchema.safeParse(input).success).toBe(false);
  });

  test("rejects missing record", () => {
    expect(writeMemorySchema.safeParse({}).success).toBe(false);
  });
});

describe("touchRecalledSchema", () => {
  test("accepts non-empty ids array", () => {
    expect(touchRecalledSchema.safeParse({ ids: ["mem_1"] }).success).toBe(true);
  });

  test("rejects empty ids array", () => {
    expect(touchRecalledSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  test("rejects empty string in ids", () => {
    expect(touchRecalledSchema.safeParse({ ids: [""] }).success).toBe(false);
  });
});

describe("archive schemas", () => {
  test("accepts a supersession with successors", () => {
    expect(
      retireMemoriesSchema.safeParse({ ids: ["mem_old"], disposition: { kind: "superseded", by: ["mem_new"] } })
        .success,
    ).toBe(true);
  });

  test("rejects a supersession without successors", () => {
    expect(
      retireMemoriesSchema.safeParse({ ids: ["mem_old"], disposition: { kind: "superseded", by: [] } }).success,
    ).toBe(false);
  });

  test("accepts restore ids", () => {
    expect(restoreMemoriesSchema.safeParse({ ids: ["mem_old"] }).success).toBe(true);
  });

  test("accepts archive filters and records", () => {
    expect(listArchiveMemoriesSchema.safeParse({ scopeKey: "user:1", disposition: "capacity" }).success).toBe(true);
    expect(
      memoryArchiveRecordSchema.safeParse({
        id: "mem_old",
        scopeKey: "user:1",
        kind: "stored",
        content: "old fact",
        createdAt: "2026-01-01T00:00:00.000Z",
        tokenEstimate: 2,
        retiredAt: "2026-01-02T00:00:00.000Z",
        disposition: { kind: "noise" },
      }).success,
    ).toBe(true);
  });

  test("rejects invalid archive filters", () => {
    expect(listArchiveMemoriesSchema.safeParse({ disposition: "unknown" }).success).toBe(false);
  });

  test("an archive write requires a retirement time and a disposition", () => {
    const record = {
      id: "mem_old",
      scopeKey: "user:1",
      kind: "stored",
      content: "old fact",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 2,
      retiredAt: "2026-01-02T00:00:00.000Z",
      disposition: { kind: "superseded", by: ["mem_new"] },
    };

    expect(writeArchiveMemorySchema.safeParse({ record }).success).toBe(true);
    expect(writeArchiveMemorySchema.safeParse({ record: { ...record, retiredAt: undefined } }).success).toBe(false);
    expect(writeArchiveMemorySchema.safeParse({ record: { ...record, disposition: undefined } }).success).toBe(false);
    expect(writeArchiveMemorySchema.safeParse({ record: { ...record, disposition: { kind: "superseded" } } }).success).toBe(
      false,
    );
  });
});

describe("writeEmbeddingSchema", () => {
  test("accepts valid input", () => {
    expect(writeEmbeddingSchema.safeParse({ id: "mem_1", scopeKey: "user_1", embedding: "AAAA" }).success).toBe(true);
  });

  test("rejects empty embedding", () => {
    expect(writeEmbeddingSchema.safeParse({ id: "mem_1", scopeKey: "user_1", embedding: "" }).success).toBe(false);
  });
});

describe("getEmbeddingsSchema", () => {
  test("accepts empty array", () => {
    expect(getEmbeddingsSchema.safeParse({ ids: [] }).success).toBe(true);
  });

  test("accepts ids array", () => {
    expect(getEmbeddingsSchema.safeParse({ ids: ["a", "b"] }).success).toBe(true);
  });

  test("rejects missing ids", () => {
    expect(getEmbeddingsSchema.safeParse({}).success).toBe(false);
  });
});

describe("searchEmbeddingsSchema", () => {
  test("accepts valid input", () => {
    expect(searchEmbeddingsSchema.safeParse({ queryEmbedding: "AAAA", limit: 10 }).success).toBe(true);
  });

  test("accepts with optional filters", () => {
    expect(
      searchEmbeddingsSchema.safeParse({ queryEmbedding: "AAAA", scopeKey: "user_1", kind: "observation", limit: 5 })
        .success,
    ).toBe(true);
  });

  test("rejects limit over 100", () => {
    expect(searchEmbeddingsSchema.safeParse({ queryEmbedding: "AAAA", limit: 101 }).success).toBe(false);
  });

  test("rejects limit of 0", () => {
    expect(searchEmbeddingsSchema.safeParse({ queryEmbedding: "AAAA", limit: 0 }).success).toBe(false);
  });

  test("rejects invalid kind", () => {
    expect(searchEmbeddingsSchema.safeParse({ queryEmbedding: "AAAA", kind: "bad", limit: 10 }).success).toBe(false);
  });
});

describe("saveSessionSchema", () => {
  const valid = {
    id: "sess_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    model: "gpt-4",
    title: "test",
    messages: [],
    tokenUsage: [],
  };

  test("accepts valid input", () => {
    expect(saveSessionSchema.safeParse(valid).success).toBe(true);
  });

  test("accepts with optional workspace fields", () => {
    expect(
      saveSessionSchema.safeParse({ ...valid, workspace: "/code", workspaceName: "app", workspaceBranch: "main" })
        .success,
    ).toBe(true);
  });

  test("rejects missing model", () => {
    const { model: _, ...noModel } = valid;
    expect(saveSessionSchema.safeParse(noModel).success).toBe(false);
  });

  test("rejects missing messages", () => {
    const { messages: _, ...noMessages } = valid;
    expect(saveSessionSchema.safeParse(noMessages).success).toBe(false);
  });
});

describe("setActiveSessionSchema", () => {
  test("accepts string id", () => {
    expect(setActiveSessionSchema.safeParse({ id: "sess_1" }).success).toBe(true);
  });

  test("accepts null id", () => {
    expect(setActiveSessionSchema.safeParse({ id: null }).success).toBe(true);
  });

  test("rejects missing id", () => {
    expect(setActiveSessionSchema.safeParse({}).success).toBe(false);
  });
});
