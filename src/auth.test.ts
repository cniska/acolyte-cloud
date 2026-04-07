import { describe, expect, test } from "vitest";

// Test deriveOwnerId logic directly since it's not exported.
// We replicate the logic here to test the branching.
function deriveOwnerId(payload: { sub?: string; tid?: string; oid?: string; scope?: string }): string | null {
  switch (payload.scope) {
    case "team":
      return payload.tid ?? null;
    case "org":
      return payload.oid ?? null;
    case "user":
    default:
      return payload.sub ?? null;
  }
}

describe("deriveOwnerId", () => {
  test("user scope returns sub", () => {
    expect(deriveOwnerId({ sub: "user_1", scope: "user" })).toBe("user_1");
  });

  test("team scope returns tid", () => {
    expect(deriveOwnerId({ sub: "user_1", tid: "team_1", scope: "team" })).toBe("team_1");
  });

  test("org scope returns oid", () => {
    expect(deriveOwnerId({ sub: "user_1", oid: "org_1", scope: "org" })).toBe("org_1");
  });

  test("defaults to sub when scope is missing", () => {
    expect(deriveOwnerId({ sub: "user_1" })).toBe("user_1");
  });

  test("returns null when team scope has no tid", () => {
    expect(deriveOwnerId({ sub: "user_1", scope: "team" })).toBeNull();
  });

  test("returns null when no claims at all", () => {
    expect(deriveOwnerId({})).toBeNull();
  });
});
