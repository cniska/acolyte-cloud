#!/usr/bin/env bash
set -euo pipefail

# Fail while the published contract is behind its source. A schema committed here but never released
# is invisible to every consumer: they install the older tarball, cannot import the new schema, and
# the local fix is to hand-write a copy — a silent fork with the same version number on both sides.

PACKAGE_PATH="packages/cloud-contract"

tag=$(git tag --sort=-version:refname --list 'cloud-contract-v*' | head -1)
if [ -z "$tag" ]; then
  echo "No cloud-contract-v* tag exists; cut a release before shipping the contract." >&2
  exit 1
fi

unreleased=$(git log "$tag..HEAD" --format='- %s' --no-merges -- "$PACKAGE_PATH")
if [ -n "$unreleased" ]; then
  echo "$PACKAGE_PATH has commits past $tag:" >&2
  echo "$unreleased" >&2
  echo >&2
  echo "Run: pnpm release:contract <major|minor|patch>" >&2
  exit 1
fi

echo "Contract is released: $PACKAGE_PATH matches $tag."
