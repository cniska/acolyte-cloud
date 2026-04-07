import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

const args = process.argv.slice(2);
const sub = args[0];
if (!sub) {
  console.error("Usage: pnpm sign-token <user-id> [--scope team --tid <id>] [--scope org --oid <id>]");
  process.exit(1);
}

let scope = "user";
let tid: string | undefined;
let oid: string | undefined;

for (let i = 1; i < args.length; i += 2) {
  if (args[i] === "--scope") scope = args[i + 1];
  if (args[i] === "--tid") tid = args[i + 1];
  if (args[i] === "--oid") oid = args[i + 1];
}

const keyPath = join(import.meta.dirname, "..", "private.pem");
const pem = readFileSync(keyPath, "utf-8");
const privateKey = await importPKCS8(pem, "EdDSA");

const claims: Record<string, string> = { sub, scope };
if (tid) claims.tid = tid;
if (oid) claims.oid = oid;

const token = await new SignJWT(claims)
  .setProtectedHeader({ alg: "EdDSA" })
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(privateKey);

console.log(token);
