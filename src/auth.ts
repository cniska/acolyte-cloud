import { jwtVerify, importSPKI } from "jose";

type AuthResult =
  | { ok: true; ownerId: string }
  | { ok: false; error: Response };

interface JwtPayload {
  sub?: string;
  tid?: string;
  oid?: string;
  scope?: string;
}

function deriveOwnerId(payload: JwtPayload): string | null {
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

let cachedKey: CryptoKey | null = null;

async function getVerifyKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_PUBLIC_KEY;
  if (!secret) throw new Error("JWT_PUBLIC_KEY is not set");
  cachedKey = await importSPKI(secret, "EdDSA");
  return cachedKey;
}

export async function verifyAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, error: new Response("Unauthorized", { status: 401 }) };
  }

  const token = header.slice(7);
  try {
    const key = await getVerifyKey();
    const { payload } = await jwtVerify(token, key, { algorithms: ["EdDSA"] });
    const ownerId = deriveOwnerId(payload as JwtPayload);
    if (!ownerId) {
      return { ok: false, error: new Response("Invalid token claims", { status: 401 }) };
    }
    return { ok: true, ownerId };
  } catch {
    return { ok: false, error: new Response("Invalid token", { status: 401 }) };
  }
}
