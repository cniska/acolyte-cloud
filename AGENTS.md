# Project Rules

## Tooling

- Use `pnpm` scripts directly (`pnpm typecheck`, `pnpm migrate`).

## Workflow

- Verify with `pnpm verify`.
- Release the shared contract with `pnpm release:contract <major|minor|patch>` from a clean `main` checkout.

## Process

- Keep changes scoped and minimal.
- Read relevant files before editing.
- Run the `ship` gate before cutting a release.
- The release command writes the version and changelog, creates a `cloud-contract-v<version>` tag, and prints push commands; the tag workflow publishes `@acolyte/cloud-contract` to npm and creates the GitHub release.

## Commits

- Commit only when explicitly requested.
- Use Conventional Commits: `type(scope): description`
  - Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Single-line subject only — no body, no co-author trailer.
- Keep subject lines under 72 characters.
