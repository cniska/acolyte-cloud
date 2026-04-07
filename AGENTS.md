# Project Rules

## Tooling

- Use `pnpm` scripts directly (`pnpm typecheck`, `pnpm migrate`).

## Workflow

- Keep changes scoped and minimal.
- Read relevant files before editing.

## Commits

- Commit only when explicitly requested.
- Use Conventional Commits: `type(scope): description`
  - Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Single-line subject only — no body, no co-author trailer.
- Keep subject lines under 72 characters.

## Validation

- Run `pnpm verify` before pushing.
