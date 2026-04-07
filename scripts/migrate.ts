import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(url);

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  console.log(`Running ${file}...`);
  const content = readFileSync(join(migrationsDir, file), "utf-8");
  await sql(content);
  console.log(`Done: ${file}`);
}

console.log("All migrations complete.");
