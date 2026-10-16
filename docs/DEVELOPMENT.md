# Development

## Requirements

- Node.js `>=22.13 <23`
- Corepack and `pnpm@11.17.0`
- Docker Desktop or a compatible Docker Engine and Compose installation
- Git

## First setup

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm env:setup
docker compose -f deploy/compose.dev.yaml up -d
corepack pnpm setup:dev
```

`env:setup` creates only missing component files and never overwrites edited
configuration. If a pre-baseline `.env` exists, matching values are migrated into a
missing file or a file that is still byte-for-byte identical to its example. The
generated files are:

- `.env.local`: instance, MySQL, storage, and shared deployment policy;
- `apps/server/.env.local`: HTTP, authentication, demo, and development administrator;
- `apps/worker/.env.local`: Redis, Worker, and provider adapters;
- `apps/web/.env.local`: public Vite build-time variables.

See [CONFIGURATION.md](CONFIGURATION.md) for the complete variable analysis.
Production processes do not read these local files; the orchestrator must inject
variables and mount secret files.

`setup:dev` applies migrations, creates the development instance and administrator,
registers the built-in Runtime Adapter registry, and registers the official Capability
and Model Resource recommendations. Recommendations remain uninstalled until a user
selects one through the Capability or Model Resource administration flow; setup does
not preinstall Capability Definitions, Bindings, Workflows, Skills, or model bytes. It
is only for a local development database. Login credentials come from
`apps/server/.env.local`.

## Start

```bash
corepack pnpm start:dev
```

The command builds the Server and Worker workspace dependencies, then checks the
Node version, component configuration, fixed application ports, and MySQL and Redis
connectivity before starting all components:

| Component     | Address                 |
| ------------- | ----------------------- |
| Web           | `http://127.0.0.1:5173` |
| Server        | `http://127.0.0.1:3000` |
| Worker health | `http://127.0.0.1:3001` |

Vite can begin accepting browser connections while Server is still compiling. During
the first 45 seconds, the development proxy reports one neutral waiting message and
returns `503` with `Retry-After: 1` instead of printing repeated connection-refused
stacks. Treat the explicit `Kanvas is ready` message as the usable boundary. Proxy
errors outside that startup window remain errors.

Check prerequisites without starting processes:

```bash
corepack pnpm start:dev -- --check
```

Run one component:

```bash
corepack pnpm dev:web
corepack pnpm dev:server
corepack pnpm dev:worker
```

Server and Worker share a TypeScript watch launcher. It starts `dist` after the first
successful compilation and restarts only after later successful compilations. Changes
to package `dist` output also restart the process, keeping development execution
aligned with production build semantics.

Stop local infrastructure:

```bash
docker compose -f deploy/compose.dev.yaml down
```

Database volumes are preserved by default. Add `--volumes` only when intentionally
erasing the local development database; that operation is irreversible.

## Contracts and migrations

TypeBox is the contract authority:

```text
TypeBox -> JSON Schema 2020-12 -> OpenAPI 3.1 -> Web types
```

After changing a contract, run:

```bash
corepack pnpm generate:contracts
corepack pnpm generate:check
```

Migrations live in `packages/database/migrations/` and use four-digit sequence
numbers. The first public version creates a complete empty database from the single
`0000_initial_schema.sql` migration; later releases append forward-only migrations.
Preview and apply them with:

```bash
corepack pnpm migrate:plan
corepack pnpm migrate
```

Never modify a migration that has reached a shared environment or public release.
Schema changes require a new file and verification from both an empty database and
the previous public version.

## Checks

Use the smallest relevant check while developing, for example:

```bash
corepack pnpm --filter @kanvas/server test
corepack pnpm --filter @kanvas/worker check-types
corepack pnpm --filter @kanvas/web build
```

Repository-level commands:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm arch:check
corepack pnpm check-types
corepack pnpm test
corepack pnpm build
corepack pnpm audit:prod
corepack pnpm verify
```

`verify` is the complete pre-release gate: generated-output drift, formatting, lint,
code health, architecture, types, tests, development commands, production builds,
and dist-only startup. Local changes do not need this entire gate after every edit.

## Integration tests

Real MySQL integration tests create, truncate, and delete derived databases. Connect
them only to a dedicated disposable MySQL instance, never to a shared development,
test, staging, or production database.

```bash
KANVAS_DATABASE_DISPOSABLE_INTEGRATION=1 \
KANVAS_DATABASE_HOST=127.0.0.1 \
KANVAS_DATABASE_PORT=3306 \
KANVAS_DATABASE_USER=root \
KANVAS_DATABASE_PASSWORD=kanvas-root \
  corepack pnpm test:integration:mysql
```

Use `KANVAS_DATABASE_SOCKET` for a Unix socket. Real S3, provider, and browser
execution checks each require their own external service or fixed fixtures. Default
tests do not present mocked behavior as completed external end-to-end verification.

## Docker builds

```bash
docker build --target server -t kanvas-server:local .
docker build --target worker -t kanvas-worker:local .
docker build --target web -t kanvas-web:local .
```

The Dockerfile uses a BuildKit pnpm-store cache, multi-stage builds, and `pnpm deploy`
to produce isolated production dependency trees. Server and Worker run as UID/GID
`10001`; Web uses a read-only Nginx runtime.

## Model-backed tests

`pnpm test` (and therefore `pnpm verify`) prepares two pinned ONNX test models
before running the suites. The first run downloads approximately 93 MB from the
public rembg release and the immutable ISNet catalog source. Downloads are bounded
by exact byte size and verified with SHA-256 before execution. Subsequent runs
verify and reuse `.tmp/test-models/`; these files are ignored and excluded from
Docker build contexts and public exports. This does not install runtime models.

Run `pnpm prepare:test-models` before invoking the model integration tests directly.
For offline testing, pre-populate this cache with the exact pinned bytes; a digest
mismatch fails closed. Model-backed assertions are not skipped when a cache is absent.
