# Acolyte Cloud Specification

> A self-hostable, authenticated storage API for Acolyte's memory and session data, for users who want to run their own backend instead of a shared one.

This document specifies what the API must do, not how. Implementation choices are the builder's, provided the requirements and acceptance criteria below hold. Fixed decisions live in §8; everything in §9 is deliberately left open.

## 1. Purpose & context

Acolyte normally stores memory and session data in a shared cloud service. This project lets a user run that same storage layer themselves — on their own Vercel account and their own Postgres database — while remaining API-compatible with the Acolyte CLI.

**Primary user:** a single Acolyte user self-hosting their own storage backend.

**Reference product:** the shared `app.acolyte.sh` cloud backend this project is a self-hosted alternative to.

## 2. Functional requirements

### 2.1 Core behavior

- **FR-1** — The API stores and retrieves durable *memory* records, each scoped to an owner and a `scopeKey` (user, project, or session), with a `kind` of `observation` or `stored`.
- **FR-2** — The API stores and retrieves *chat session* transcripts (messages and token usage) and tracks which session is currently "active" for an owner.
- **FR-3** — The API stores and retrieves *vector embeddings* associated with memories, and supports similarity search over them.
- **FR-4** — Every record is isolated by owner: no request can read or write another owner's data, regardless of record id collisions.

### 2.2 Input handling

- **FR-5** — Every `/api/v1/*` request must carry `Authorization: Bearer <token>` containing a valid EdDSA-signed JWT; requests without one, or with an invalid, expired, or unparseable token, are rejected before touching storage.
- **FR-6** — The owner identity for a request is derived from the token's `sub` claim.
- **FR-7** — JSON request bodies are accepted gzip-compressed (`Content-Encoding: gzip`) or plain.
- **FR-8** — A request body exceeding 4,500,000 bytes (compressed or decompressed) is rejected as invalid input, not as a server error.
- **FR-9** — Malformed JSON, or a body that fails its endpoint's schema, is rejected with a 400 and a JSON body of the shape `{"error": "<message>"}`.
- **FR-10** — An embedding is transmitted as a base64-encoded 32-bit-float vector; a value that doesn't decode to a whole number of floats is rejected as invalid.

### 2.3 Feature coverage — memories

- **FR-11** — List memories for the caller's owner, optionally filtered by `scopeKey` and/or `kind`.
- **FR-12** — Create or update (upsert) a memory record.
- **FR-13** — Delete a memory record by id.
- **FR-14** — Mark a batch of memories as recalled (updates their `lastRecalledAt`).
- **FR-15** — Retire a batch of memories to the archive with a disposition of `superseded` (citing the superseding memory ids), `capacity`, or `noise`; retiring also deletes the memories' embeddings.
- **FR-16** — List archived memories, optionally filtered by `scopeKey`, `kind`, and/or `disposition`.
- **FR-17** — Restore a batch of archived memories back to active memory, without their embeddings (a restored memory has no embedding until one is written again).
- **FR-17a** — Create or update (upsert) an archived memory directly, carrying the client's own retirement time and disposition, so a client holding an already-retired memory does not have to write it as active and then retire it.
- **FR-17b** — A memory id is present in either active memory or the archive, never both: retiring and archive-writing each remove any active memory holding that id, along with that memory's embedding. Repeating either leaves one archive record holding the latest values.

### 2.4 Feature coverage — embeddings

- **FR-18** — Create or update (upsert) an embedding for a memory id.
- **FR-19** — Delete an embedding by id.
- **FR-20** — Batch-fetch embeddings by id, returning only the ones that exist.
- **FR-21** — Search memories by embedding similarity, optionally filtered by `scopeKey` and/or `kind`, returning up to a caller-specified limit (max 100) ordered nearest-first.

### 2.5 Feature coverage — sessions

- **FR-22** — List the caller's sessions, most-recently-updated first, up to a caller-specified limit.
- **FR-23** — Create or update (upsert) a session (id, timestamps, model, title, workspace info, messages, token usage).
- **FR-24** — Get a single session by id, or `null` if it doesn't exist for the caller.
- **FR-25** — Incrementally append messages and/or token usage to an existing session, patching only the fields provided; appending to a session id that doesn't exist for the caller returns a "not found" error rather than creating one.
- **FR-26** — Delete a session by id.
- **FR-27** — Search a session's messages by substring match against message content, excluding `status`-kind messages, up to a caller-specified limit (default 10, max 50).
- **FR-28** — Get and set which session id is "active" for the caller; getting returns `null` if none is set.

### 2.6 Discovery & documentation

- **FR-29** — The API serves a machine-readable OpenAPI 3.0.3 document describing every endpoint, its request/response schemas, and error shapes.
- **FR-30** — The API serves an interactive human-readable API reference generated from that document.
- **FR-31** — The API serves a human-facing landing page at its root.
- **FR-32** — The API serves a liveness check endpoint that requires no authentication.

### 2.7 Edge cases requiring special handling

- **FR-33** — A `kind` filter value outside `observation`/`stored` is rejected as invalid input, not silently ignored or treated as "no filter".
- **FR-34** — A malformed or non-multiple-of-4-bytes embedding payload is rejected as invalid input rather than causing a decode exception to escape.
- **FR-35** — Retiring memories and deleting their embeddings happens atomically: either both succeed or neither does.
- **FR-36** — Any request to an unrecognized method or sub-path under `/api/v1/*` still runs authentication before responding, so an unauthenticated caller cannot use path/method probing to distinguish "route doesn't exist" from "route exists but wrong method" without a valid token. **[unverified: whether returning 405 for method-not-allowed vs. 404 for path-not-found, post-auth, is a deliberate distinction API consumers should rely on.]**

## 3. AU — Authentication & authorization requirements

- **AU-1** — Tokens are signed with EdDSA (Ed25519) and verified against a single configured public key; there is no support for multiple active signing keys or key rotation without redeploying. **[unverified: whether key rotation is out of scope by design, or an unaddressed gap.]**
- **AU-2** — Tokens expire; an expired token is rejected the same way an invalid one is (opaque failure, no distinct "expired" vs "invalid" signal to the caller). **[unverified: whether callers are expected to distinguish expiry from other invalidity — today they cannot.]**
- **AU-3** — Token issuance (signing) is a local, offline operation performed by whoever holds the private key; the API itself never issues tokens.
- **AU-4** — A token's owner (`sub`) is fixed for its lifetime; there is no in-API way to reassign ownership of existing records.

## 4. Non-functional requirements

- **NF-1** — The API runs as Vercel serverless functions behind a single deployment; each request is independently routable with no server-side session/connection affinity required.
- **NF-2** — Data is stored in Postgres (Neon) with the `vector` extension; every table partitions rows by `owner_id` and every query filters by it.
- **NF-3** — A request rejected for invalid input, an unrecognized path, or an unhandled exception always returns a JSON error body of the shape `{"error": "<message>"}` — never an unhandled exception escaping to the platform default, and never a non-JSON body.
- **NF-4** — Every failure mode has a stable, documented shape: 400 for invalid input, 401 for authentication failure, 404 for a referenced resource or path that doesn't exist, 405 for a valid path with an unsupported method, 500 for an unhandled server-side fault (with no internal detail — message or stack — disclosed to the caller).
- **NF-8** — Every response carries a unique request id (`x-request-id` header), generated per-request rather than trusted from the caller, so a client-reported problem can be correlated with server-side logs for that exact request.
- **NF-9** — Every request produces exactly one structured log line recording method, path, status, duration, and its request id; an unhandled exception additionally logs the error message and stack against the same request id.

### 4.1 Testing

- **NF-5** — Unit tests cover the HTTP surface (`app.test.ts`), schema validation (`schemas.test.ts`), authentication (`auth.test.ts`), and body parsing (`parse.test.ts`), mocking the database and JWT verification rather than exercising them for real.
- **NF-6** — The OpenAPI document itself is asserted against in tests: every write endpoint documents a request schema, every endpoint that returns a body documents a response schema, and metadata (servers, tags, operationId) is present for every operation.
- **NF-7** — `pnpm verify` (contract build, typecheck, test) must pass before any change ships.

## 5. Out of scope

- Multi-key JWT verification / signing-key rotation (§AU-1).
- Distinguishing "expired" from "otherwise invalid" tokens to the caller (§AU-2).
- In-API token issuance, refresh, or revocation.
- Rate limiting and CORS (neither implemented nor currently required by any known consumer).
- External error tracking (e.g. Sentry) and log aggregation — logs are emitted (NF-9) but not shipped anywhere beyond the platform's own log capture.
- Reassigning existing records between owners.
- Team- or org-scoped ownership (multiple people sharing one set of records under one token). Every token maps to exactly one owner via `sub`.

## 6. Acceptance criteria

- **AC-1** — A request without a valid bearer token to any `/api/v1/*` endpoint is rejected before any database access, for every documented endpoint. *(FR-5, FR-6, AU-1..4)*
- **AC-2** — A memory written by owner A is never returned, updated, or deleted by a request authenticated as owner B, even when using the same record id. *(FR-4, FR-11..21)*
- **AC-3** — Retiring a set of memories removes them from the active table, adds them to the archive with the given disposition, and removes their embeddings, as one atomic operation — a failure partway through leaves no partial state. *(FR-15, FR-35)*
- **AC-4** — A memory restored from the archive is retrievable via the active-memory endpoints but returns no embedding until one is written again. *(FR-17, FR-18)*
- **AC-4a** — A memory written straight to the archive appears in the caller's archive listing with the retirement time and disposition it was given, and not in active memory; repeating the write with changed values updates the one record. Retiring an id that is already archived succeeds and leaves it only in the archive. *(FR-17a, FR-17b)*
- **AC-5** — Appending to a session id the caller doesn't own or that doesn't exist returns a "not found" response rather than creating a new session. *(FR-25)*
- **AC-6** — A gzip-compressed request body over the byte limit, and a plain body over the byte limit, are both rejected the same way. *(FR-7, FR-8)*
- **AC-7** — `/doc` and `/reference` are reachable without authentication and describe every `/api/v1/*` endpoint, including its response schema where one exists. *(FR-29, FR-30, NF-6)*
- **AC-8** — `pnpm verify` passes on a clean checkout. *(NF-7)*
- **AC-9** — A request to a path that matches nothing, and an unhandled exception thrown by any handler, both return a JSON `{"error": "..."}` body with an `x-request-id` header — never a plain-text or HTML default, never leaked exception detail. *(NF-3, NF-4, NF-8, NF-9)*

## 7. Deliverables

- **D-1** — The deployed Vercel application: a single Hono entrypoint (`src/app.ts`) covering every route.
- **D-2** — Database migrations (`migrations/*.sql`) sufficient to provision a fresh database from nothing.
- **D-3** — `@acolyte/cloud-contract`, the published npm package of shared request/response Zod schemas.
- **D-4** — Setup and token-signing scripts (`scripts/setup.ts`, `scripts/sign-token.ts`, `scripts/migrate.ts`).
- **D-5** — The test suite (§4.1) and the OpenAPI document it verifies.
- **D-6** — `README.md` documenting self-hosted setup end to end.

## 8. Constraints (fixed)

- **C-1** — Runtime: Vercel serverless functions, deployed via `vercel deploy`.
- **C-2** — Framework: Hono, using `@hono/zod-openapi` for request/response schema declaration and OpenAPI generation.
- **C-3** — Database: Postgres with the `pgvector` extension, accessed via `@neondatabase/serverless`; embeddings are fixed at 1536 dimensions.
- **C-4** — Authentication: bearer JWTs signed with EdDSA (Ed25519); no other auth scheme.
- **C-5** — Request/response contracts are Zod schemas, defined once in `@acolyte/cloud-contract` and shared between the API and its consumers (the Acolyte CLI).
- **C-6** — Every stored row is keyed by `(owner_id, id)`; there is no cross-owner query path.

## 9. Open decisions (left to the builder)

- Whether to enforce Hono's `c.req.valid()` automatic validation on routes that already declare `request.params`/`request.query` for documentation purposes, instead of the current manual `.safeParse()` duplication (bounded by NF-4, AC-1 — must not weaken auth-before-validation ordering).
- Whether `deriveOwnerId`'s fallback-to-`sub`-on-unknown-scope (FR-6) should become an explicit rejection.
- Whether logs (NF-9) should ever ship to an external sink, beyond the platform's own log capture (bounded by §5's exclusion of external error tracking).

### Policies chosen (not open)

- Requests are authenticated before any input validation runs, on every `/api/v1/*` route — serves FR-5, AC-1.
- Retiring memories always deletes their embeddings; restoring never brings embeddings back — serves FR-15, FR-17, AC-4.
- Every route — including unmatched paths and doc/landing routes — shares one JSON error envelope and one request-id/logging middleware; there is no root-level exemption from NF-3/NF-4 — serves NF-3, NF-4, NF-8, NF-9.
- The request id is always server-generated, never trusted from an inbound header, so it can't be spoofed to collide with another request's logs — serves NF-8.
