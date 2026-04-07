import { describe, expect, test } from "vitest";
import { base64ToVector, extractId, parseJson, vectorToBase64 } from "./parse.js";

describe("parseJson", () => {
  test("parses valid JSON body", async () => {
    const req = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
      headers: { "content-type": "application/json" },
    });
    expect(await parseJson(req)).toEqual({ foo: "bar" });
  });

  test("returns null for invalid JSON", async () => {
    const req = new Request("https://example.com", {
      method: "POST",
      body: "not json",
    });
    expect(await parseJson(req)).toBeNull();
  });

  test("returns null for empty body", async () => {
    const req = new Request("https://example.com", { method: "POST" });
    expect(await parseJson(req)).toBeNull();
  });
});

describe("base64ToVector", () => {
  test("converts valid base64 float32 array to pgvector string", () => {
    const floats = new Float32Array([1.0, 2.0, 3.0]);
    const buf = Buffer.from(floats.buffer);
    const b64 = buf.toString("base64");
    const result = base64ToVector(b64);
    expect(result).toBe("[1,2,3]");
  });

  test("returns null for empty string", () => {
    expect(base64ToVector("")).toBeNull();
  });

  test("returns null for non-aligned byte length", () => {
    const buf = Buffer.alloc(5);
    expect(base64ToVector(buf.toString("base64"))).toBeNull();
  });
});

describe("vectorToBase64", () => {
  test("round-trips through base64ToVector", () => {
    const floats = new Float32Array([0.5, -1.5, 3.14]);
    const buf = Buffer.from(floats.buffer);
    const b64 = buf.toString("base64");

    const pgVector = base64ToVector(b64)!;
    const roundTripped = vectorToBase64(pgVector);
    expect(roundTripped).toBe(b64);
  });
});

describe("extractId", () => {
  test("extracts last path segment", () => {
    const req = new Request("https://example.com/api/v1/memories/mem_123");
    expect(extractId(req)).toBe("mem_123");
  });

  test("decodes URI-encoded characters", () => {
    const req = new Request("https://example.com/api/v1/memories/mem%2F123");
    expect(extractId(req)).toBe("mem/123");
  });
});
