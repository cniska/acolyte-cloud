import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const releaseLevel = process.argv[2];
if (releaseLevel !== "major" && releaseLevel !== "minor" && releaseLevel !== "patch") {
  console.error("Usage: pnpm release:contract <major|minor|patch>");
  process.exit(1);
}

const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: "utf8" }).trim();
const packageDir = join(import.meta.dirname, "..", "packages", "cloud-contract");
const packagePath = join(packageDir, "package.json");
const changelogPath = join(packageDir, "CHANGELOG.md");

if (run("git", ["branch", "--show-current"]) !== "main") {
  throw new Error("Release from main.");
}
if (run("git", ["status", "--porcelain"])) {
  throw new Error("Release from a clean working tree.");
}

run("pnpm", ["verify"]);

const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
const versionParts = pkg.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!versionParts) {
  throw new Error(`Package version must be a stable SemVer version: ${pkg.version}`);
}

const [, major, minor, patch] = versionParts.map(Number);
const nextVersion =
  releaseLevel === "major"
    ? `${major + 1}.0.0`
    : releaseLevel === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const latestTag = run("git", ["tag", "--sort=-version:refname", "--list", "cloud-contract-v*"]).split("\n")[0];
const commitRange = latestTag ? `${latestTag}..HEAD` : "HEAD";
const commits = run("git", ["log", commitRange, "--format=- %s", "--no-merges", "--", "packages/cloud-contract"]);
if (!commits) {
  throw new Error("No commits to release.");
}

const tag = `cloud-contract-v${nextVersion}`;
if (run("git", ["tag", "--list", tag])) {
  throw new Error(`Tag already exists: ${tag}`);
}

pkg.version = nextVersion;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  `# Changelog\n\n## ${nextVersion} - ${date}\n\n${commits}\n\n${readFileSync(changelogPath, "utf8").replace(/^# Changelog\n+/, "")}`,
);

run("git", ["add", packagePath, changelogPath]);
run("git", ["commit", "-S", "-m", `chore(contract): release v${nextVersion}`]);
run("git", ["tag", "-a", tag, "-m", `Release cloud contract v${nextVersion}`]);

console.log(`Created ${tag}.`);
console.log("Push when ready:");
console.log("git push origin main");
console.log(`git push origin ${tag}`);
