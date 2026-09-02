# Versioning

This repository publishes one package: `@acolyte/cloud-contract`, the wire schemas shared with the
CLI and the dashboard. Its npm version is the only version anything outside this repository reads.

## Rules

- While the package is below `1.0.0`, a removal or a changed shape is a minor and an addition is a
  patch. A new schema, or a new optional field on an existing one, is an addition. The major digit
  stays at `0` until the contract is declared stable, so a breaking change is never what carries it
  to `1.0.0`.
- A published version's content is never edited. A mistake ships as the next version.
- A change under `packages/cloud-contract` is invisible to consumers until it is released. Release
  first, then bump the dependency in the consumer.
- `pnpm release:contract <major|minor|patch>` is the only way to cut a version. It refuses a dirty
  tree or a branch other than `main`, runs `pnpm verify`, writes the changelog from the commits since
  the last tag, and makes the signed commit and the `cloud-contract-v<version>` tag. Pushing the tag
  is what publishes.
- The publish authenticates through npm trusted publishing: the workflow proves its identity over
  OIDC, so there is no npm token and no secret to rotate. A publish that fails on authorization is
  fixed by checking the trusted publisher registered for the package, never by adding a token.
- A release is done when the publish workflow goes green, not when the tag is pushed. The script
  printing a tag and the push succeeding say nothing about whether npm received the package;
  `npm view @acolyte/cloud-contract version` is the answer.

## The guard

`pnpm check:contract` fails when `packages/cloud-contract` carries commits past the newest
`cloud-contract-v*` tag. CI runs it as a step of its own rather than inside `verify`, because
`release:contract` runs `verify` before it bumps and tags — a guard inside `verify` would block the
release that clears it.

Without it, a schema can be committed here and never published while the version number keeps saying
nothing changed. A consumer then installs the older tarball, cannot import the new schema, and the
obvious local fix is to hand-write a copy of it — at which point the contract has silently forked and
the version number still reads the same on both sides.
