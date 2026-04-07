import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const root = join(import.meta.dirname, "..");

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

console.log("Acolyte Cloud setup\n");

// 1. Database URL
const envPath = join(root, ".env");
let databaseUrl: string;

if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf-8");
  const match = env.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (match) {
    databaseUrl = match[1];
    console.log("Found DATABASE_URL in .env");
  } else {
    databaseUrl = await ask("Neon connection string: ");
    writeFileSync(envPath, `DATABASE_URL="${databaseUrl}"\n`);
  }
} else {
  databaseUrl = await ask("Neon connection string: ");
  writeFileSync(envPath, `DATABASE_URL="${databaseUrl}"\n`);
}

// 2. Keypair
const privatePath = join(root, "private.pem");
const publicPath = join(root, "public.pem");

if (!existsSync(privatePath)) {
  console.log("Generating Ed25519 keypair...");
  execSync(`openssl genpkey -algorithm ed25519 -out "${privatePath}"`);
  execSync(`openssl pkey -in "${privatePath}" -pubout -out "${publicPath}"`);
  console.log("Created private.pem and public.pem");
} else {
  console.log("Keypair already exists");
}

// 3. Migrate
console.log("Running migrations...");
execSync(`DATABASE_URL="${databaseUrl}" pnpm migrate`, { cwd: root, stdio: "inherit" });

console.log("\nDone! Next steps:");
console.log("  1. vercel link");
console.log("  2. cat public.pem | vercel env add JWT_SECRET production");
console.log("  3. vercel deploy --prod");
