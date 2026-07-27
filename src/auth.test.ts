import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { verifyAuth } from "./auth.js";

let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA");
  privateKey = pair.privateKey;
  process.env.JWT_PUBLIC_KEY = await exportSPKI(pair.publicKey);
});

function request(authorization?: string): Request {
  return new Request("https://cloud.example", authorization ? { headers: { authorization } } : undefined);
}

async function sign(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(privateKey);
}

describe("verifyAuth", () => {
  test("rejects a missing Authorization header", async () => {
    const result = await verifyAuth(request());

    expect(result).toEqual({ ok: false, error: expect.any(Response) });
    expect(result.ok || (await result.error.text())).toBe("Unauthorized");
  });

  test("rejects a header without a Bearer prefix", async () => {
    const result = await verifyAuth(request("Token abc"));

    expect(result.ok).toBe(false);
  });

  test("accepts a valid token and derives the owner from sub", async () => {
    const token = await sign({ sub: "user_1" });

    const result = await verifyAuth(request(`Bearer ${token}`));

    expect(result).toEqual({ ok: true, ownerId: "user_1" });
  });

  test("rejects a valid token with no sub claim", async () => {
    const token = await sign({});

    const result = await verifyAuth(request(`Bearer ${token}`));

    expect(result.ok).toBe(false);
    expect(result.ok || (await result.error.text())).toBe("Invalid token claims");
  });

  test("rejects a malformed token", async () => {
    const result = await verifyAuth(request("Bearer not-a-jwt"));

    expect(result.ok).toBe(false);
    expect(result.ok || (await result.error.text())).toBe("Invalid token");
  });
});
