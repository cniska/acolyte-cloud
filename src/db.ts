import { type NeonQueryFunction, neon } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getDb() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cached = neon(url);
  return cached;
}
