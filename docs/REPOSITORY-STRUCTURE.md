# Monorepo, modules, and builds

## Directories

| Path                     | Responsibility                                         |
| ------------------------ | ------------------------------------------------------ |
| `apps/web`               | React/Vite client and Canvas                           |
| `apps/server`            | NestJS/Fastify HTTP application and composition root   |
| `apps/worker`            | Asynchronous orchestration, execution, and maintenance |
| `packages/contracts`     | TypeBox contracts and generation authority             |
| `packages/application`   | Use cases, policies, and domain validation             |
| `packages/database`      | MySQL schema, transactional stores, and migrations     |
| `packages/agent-runtime` | Mastra adapter and Agent model ports                   |
| `packages/storage`       | Object storage, validation, and transfer               |
| `packages/secrets`       | Secret resolution and controlled writes                |
| `packages/recovery`      | Backup, restore, and evidence validation               |
| `tools`                  | Repository checks, development commands, and evals     |
| `scenario-packs`         | First-party scenario content and validation            |
| `agent-packs`            | First-party Agent surface declarations                 |
| `docs/decisions`         | Accepted and superseded ADRs                           |
| `deploy`                 | Compose, Nginx, and deployment guidance                |

Phase plans, screenshots, temporary reports, and personal environment files do not
belong in source directories.

## Dependency direction

```text
contracts
    ^
application
    ^
database / agent-runtime / storage / secrets
    ^
server / worker
```

Web communicates with Server only through the generated HTTP contract.

- `contracts` depends on no application, database, or runtime package.
- `application` does not depend on database, NestJS, Fastify, BullMQ, or provider
  SDKs.
- `database` implements Application ports and does not own business policy.
- `agent-runtime` reaches models, tools, and persistent state only through Kanvas
  ports.
- `server` and `worker` are composition roots, not homes for reusable domain logic.
- Cross-package imports use public exports and never deep-import internal files.

`tools/architecture-test` enforces these directions.

## Package rules

- Packages use ESM and explicit `.js` import suffixes.
- Cross-package versions use `workspace:` or the shared catalog.
- Runtime dependencies belong in `dependencies`; tests, types, and build tools belong
  in `devDependencies`.
- The root remains `private` to prevent accidental publication of the monorepo.
- A new package needs an independent authority, at least two real consumers, or a
  clear deployment boundary. Keep single-use code in its existing module.
- Do not create domain-free containers named `common`, `shared`, or `utils`.

## Application modules

Application code is organized by business domain:

```text
modules/<domain>/
  application/
  domain/
  index.ts
```

Application use cases accept trusted authorities, business input, and explicit
dependencies such as time and ID generation. HTTP requests, database connections,
environment variables, and provider clients remain outside this boundary.

## Contracts

`packages/contracts` provides:

- shared primitives;
- HTTP route schemas;
- Workflow, Capability, Editor, and event protocols;
- OpenAPI and JSON Schema generation entry points.

Generated files live in `packages/contracts/generated` and
`apps/web/src/api/generated`. They are committed so consumers can inspect a change
without running code generation first.

## Database

- `src/schema` is the current Drizzle type authority.
- `migrations` contains the first public version's `0000_initial_schema.sql`.
- `src/runtime` contains transactional stores, the migrator, and execution
  persistence.
- Applications do not bypass stores to execute SQL directly.
- Integration tests use random disposable databases created by their runner.

See [DATA-ACCESS.md](DATA-ACCESS.md) for database evolution rules.

## Application composition roots

Server owns:

- HTTP, authentication, authorization context, CSRF, and response projection;
- assembly of Application, Database, Storage, and Secret adapters;
- live and ready health checks.

Worker owns:

- Workflow orchestration, Capability execution, and provider invocation;
- Outbox Relay, Scheduler, Reconciler, and Maintenance;
- Worker Role and Generation Fence.

Web owns:

- page routing, server-state queries, and local interaction;
- Canvas v1 documents, runtime resources, and command history;
- controlled Browser Executor operation.

## Development and builds

- `engines` pins Node to 22.x.
- `packageManager` pins pnpm.
- Turborepo manages the package graph, incremental builds, type checks, and tests.
- Vite performs route-level Web splitting; Server and Worker emit TypeScript ESM.
- Docker multi-stage builds share the pnpm store and produce separate Server, Worker,
  and Web images.

Common gates:

```bash
pnpm generate:check
pnpm static:check
pnpm test
pnpm test:integration:mysql
pnpm build
pnpm verify:dist
```

## Before adding code

1. Identify the business authority and existing module.
2. Reuse existing contracts, ports, stores, and components.
3. Extract a package only after genuine cross-boundary reuse appears.
4. Keep user-invisible phase fixtures in tests and delete them when the task ends.
5. Add an ADR and update current-fact documentation when an architecture invariant
   changes.
