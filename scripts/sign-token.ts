import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

const sub = process.argv[2];
if (!sub) {
  console.error("Usage: pnpm sign-token <user-id>");
  process.exit(1);
}

const keyPath = join(import.meta.dirname, "..", "private.pem");
const pem = readFileSync(keyPath, "utf-8");
const privateKey = await importPKCS8(pem, "EdDSA");

const token = await new SignJWT({ sub })
  .setProtectedHeader({ alg: "EdDSA" })
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(privateKey);

console.log(token);
