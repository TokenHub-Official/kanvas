# Kanvas

Kanvas is an AI creative operations platform for visual teams. It connects
source material, canvas editing, workflows, browser and worker execution,
provider calls, human review, delivery, and reusable assets in one recoverable
and traceable production loop.

Kanvas is an open-source project maintained by [TokenHub](https://tokenhub.com),
a unified API platform for text, image, video, and audio models.

Explore available models at [tokenhub.com](https://tokenhub.com).

It is currently pre-release software; review the deployment and backup guidance
before using it with important data.

## Architecture at a glance

- The React and Vite Web app provides the workspace, Canvas, Workflow, Agent,
  Asset, Brand, and administration surfaces.
- The NestJS and Fastify Server owns HTTP, authentication, authorization, and
  application use-case composition.
- The Worker owns workflow orchestration, capability execution, provider calls,
  recovery, and maintenance jobs.
- MySQL is the business system of record. Redis and BullMQ carry rebuildable
  delivery state only.
- Capabilities are routed through governed Browser, Worker, or Provider targets.
- Immutable Artifacts, versioned Workflows, Skills, and Brands, plus audit facts,
  keep accepted results explainable.

See [Architecture](docs/ARCHITECTURE.md) and the
[ADR index](docs/decisions/README.md) for the detailed boundaries.

## Quick start

Requirements: Node.js 22, Corepack, Docker, and Git.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm env:setup
docker compose -f deploy/compose.dev.yaml up -d
corepack pnpm setup:dev
corepack pnpm start:dev
```

Development setup registers the official Capability and Model Resource recommendations
and the built-in Runtime Adapter registry. It leaves recommendations uninstalled until
they are explicitly selected in the administration UI.

Adjust `.env.local`, `apps/server/.env.local`,
`apps/worker/.env.local`, and `apps/web/.env.local` when needed. Open
`http://127.0.0.1:5173` after startup. See
[Configuration](docs/CONFIGURATION.md) for ownership, necessity, defaults, and
structured-value rules.

`pnpm start:dev -- --check` runs version, configuration, port, and
infrastructure preflight checks without starting watchers.

## Common commands

```bash
corepack pnpm start:dev       # Preflight and start Web, Server, and Worker
corepack pnpm dev:web         # Start Web only
corepack pnpm dev:server      # Start Server only
corepack pnpm dev:worker      # Start Worker only
corepack pnpm check-types     # Check all workspace types
corepack pnpm test            # Run repository unit tests
corepack pnpm build           # Build all production targets
corepack pnpm verify          # Run the complete release gate
```

The real MySQL integration suite destroys its derived test databases and must
run only against a dedicated disposable instance. See
[Development](docs/DEVELOPMENT.md) for the command and safety boundary.

## Docker

Use containers for local MySQL and Redis:

```bash
docker compose -f deploy/compose.dev.yaml up -d
```

Build and run the single-host deployment baseline:

```bash
cp deploy/.env.example deploy/.env
# Configure external MySQL/Redis, public origin and secrets in deploy/.env first.
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml exec kanvas kanvas admin --email=owner@example.com
```

The single application container includes Web, Server and Worker. It applies
forward migrations before startup; MySQL and Redis are external services.
Replace example secrets, public origins, storage paths and image references.
See [Docker deployment](deploy/README.md) for readiness, upgrades and backups.

## Documentation and contribution

- [Documentation index](docs/README.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Repository structure](docs/REPOSITORY-STRUCTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Third-party materials](THIRD_PARTY.md)
- [Public development workflow](docs/OPEN-SOURCE-WORKFLOW.md)
- [Roadmap](docs/ROADMAP.md)

Behavioral and architectural changes should include the smallest relevant
tests. Contract changes must include regenerated outputs. Never put API keys,
database credentials, user material, or other sensitive data in issues, logs,
or reproduction repositories.

## License

Kanvas is licensed under the [Apache License 2.0](LICENSE).
