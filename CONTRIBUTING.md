# Contributing

Thank you for improving Kanvas. Contributions are accepted under the
[Apache License 2.0](LICENSE). Submit only code, documentation, and media that
you have the right to contribute.

## Before you start

1. Search existing issues and ADRs to confirm that the problem is not already
   resolved.
2. Propose a short design note before changing a public contract, schema,
   dependency, cross-module boundary, or substantial feature.
3. Small bug fixes and documentation corrections may proceed as focused changes.

## Local environment

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm env:setup
docker compose -f deploy/compose.dev.yaml up -d
corepack pnpm setup:dev
corepack pnpm start:dev
```

The root `package.json` defines the supported Node.js and pnpm versions. Do not
commit local environment files, secrets, user material, model weights, database
copies, test screenshots, or generated caches.

## Language and documentation

- Maintainer-facing documentation and source comments use English.
- User-facing copy belongs in the i18n resources and may be localized.
- Comments should explain an invariant, safety boundary, non-obvious tradeoff,
  or external constraint. Delete comments that only restate the code.
- Keep current facts, durable operations guidance, and adopted ADRs. Do not add
  phase plans, completion reports, screenshot indexes, or task evidence to the
  maintained documentation set.
- Update the relevant current-fact document when behavior changes. Do not
  silently rewrite an adopted ADR; supersede it with a new decision.
- New and superseding ADRs use English. Pre-baseline ADRs may retain their original
  language as immutable historical evidence; their current facts must still be
  reflected in English documentation.

## Change principles

- Change only what the current problem requires and reuse existing domain
  objects, components, and dependencies.
- Preserve dependency direction. Run `pnpm arch:check` to detect violations.
- After changing Contract sources, run `pnpm generate:contracts` and commit the
  generated results.
- `0000_initial_schema.sql` is intended to become the first public schema baseline.
  Once a migration reaches a shared environment or public release, change the schema
  through a reviewable forward migration instead of rewriting history.
- Write user-facing copy in business language. Do not expose provider mechanics,
  database details, internal IDs, or implementation notes.
- A new dependency must justify why the standard library and current
  dependencies are insufficient, including bundle and maintenance impact.

## Verification

Run the smallest relevant engineering check during development. For code changes,
`verify` checks generated code, formatting, types, lint, architecture, builds and
compiled entry points; it does not execute business tests:

```bash
corepack pnpm verify
```

For documentation-only changes, check formatting and `corepack pnpm docs:check`.
Dependency changes also require `corepack pnpm audit:prod`. Do not introduce
high or critical production dependency vulnerabilities.

GitHub CI performs lightweight formatting, public-boundary, dependency-audit and
secret checks. Build validation is performed in the development workflow; report
which checks actually ran in the PR. Business tests remain available through
`pnpm test` and the existing specialized test commands for manual investigation
or acceptance. The MySQL suite must use a dedicated disposable instance.

## Commits and pull requests

- Keep each commit to one coherent change.
- Use `type(scope): summary` titles, for example
  `fix(worker): fence late completion`.
- Explain the problem, scope, key choices, actual verification, and uncovered
  risks in the pull request.
- Include representative journey evidence for UI changes, not only isolated
  component screenshots.
- Do not contribute third-party code, images, fonts, models, or data without
  clear provenance and compatible licensing.
