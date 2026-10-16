# Technology baseline

This document records current major technologies and their responsibility boundaries.
The root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` are authoritative
for exact versions; this is not a dependency inventory.

## Runtime and monorepo

- Node.js 22.x with repository engine `>=22.13 <23`.
- Corepack with `pnpm@11.17.0`.
- Turborepo for Workspace builds, type checks, tests, and development watch.
- TypeScript 5.9 with ESM packages and explicit `dist` output.
- ESLint, Stylelint, Prettier, Dependency Cruiser, and repository architecture tests.

Workspace packages form a directed acyclic dependency graph. Domain and Application
do not depend on NestJS, Fastify, MySQL, Redis, React, Mastra, or provider SDKs. See
[REPOSITORY-STRUCTURE.md](REPOSITORY-STRUCTURE.md) for the full direction.

## Server

- NestJS 11 provides the composition root, controllers, and lifecycle.
- Fastify 5 is the sole HTTP adapter.
- TypeBox is the HTTP contract authority and AJV performs runtime validation.
- Better Auth owns authentication protocol; Workspace authorization remains in Kanvas
  Application and Database facts.
- Pino emits structured logs and OpenTelemetry SDK optionally exports traces and
  metrics.
- Sharp performs only governed server-side media probes and transformations.

Server does not run business Workers, migrate implicitly at startup, or treat a
controller DTO as a Domain model.

## Web

- React 19 and Vite 8.
- TanStack Router and TanStack Query.
- Ant Design 6 for product components and Tailwind 4 for layout and product-owned
  styling.
- `@assistant-ui/react` and Streamdown for Agent messages.
- Tiptap for governed rich-text editing.
- XYFlow as the Workflow authoring graph adapter.
- React Colorful for color selection.

Web types are generated through TypeBox -> JSON Schema -> OpenAPI ->
`openapi-typescript`. Browser sees only public `VITE_` build variables and never a
Server or Worker secret.

## Canvas and browser runtime

Canvas Document is a versioned business contract; Renderer is not authority. Canvas
uses native browser SVG and local React state as its editing adapter. Persistence,
Undo and Redo, Artifact references, and Brand Revision follow separate Command and
Draft semantics.

Optional browser capabilities use Web Worker or WASM:

- ONNX Runtime Web runs admitted model inference.
- Catalog-published Runtime Adapters provide model-backed Browser and Worker
  abilities without a fixed capability configuration in the application shell. OCR
  uses a digest-pinned imported language model and a Worker Adapter.
- Runtime release, model, implementation, and probe pin digests.
- A capability excluded by build flags copies no model or WASM assets into the default
  bundle.

Browser execution creates a committed Artifact only through short-lived Session,
Attempt grant, lease, and Server completion protocols.

## Worker and queues

- Nest Application Context provides Worker composition.
- BullMQ and ioredis provide rebuildable delivery.
- MySQL Outbox and Inbox, leases, and fencing provide business reliability.
- ONNX Runtime Node, Sharp, and Catalog-published Runtime Adapters provide governed
  Worker media abilities.
- Vercel AI SDK provider adapters handle Agent text-model protocols.

BullMQ job state is not business authority. MySQL Workflow and Attempt facts govern
retry, cancellation, timeout, unknown side effects, and recovery.

## Agent runtime

Mastra exists only in the `@kanvas/agent-runtime` adapter package and owns the
in-process model loop, tool adapters, and stream protocol. Kanvas retains authority
over permissions, provider routing, secrets, budgets, Usage, Action Receipt, Artifact,
and durable Thread facts. See
[AGENT-PRODUCT-AND-RUNTIME-V1.md](AGENT-PRODUCT-AND-RUNTIME-V1.md).

## Data

- MySQL 8.0 is the sole primary relational database.
- Drizzle ORM expresses schemas and type-safe queries.
- `mysql2` owns connections and transaction boundaries requiring precise SQL.
- A standalone CLI applies SQL migrations explicitly.
- Redis holds only rebuildable queues and short-lived coordination.
- Local filesystem or S3-compatible Storage holds object bytes; MySQL holds object and
  Artifact facts.

The first public version creates an empty database through
`0000_initial_schema.sql`. After a public release, append forward migrations and never
edit a released file.

## Providers and secrets

Provider Model, Endpoint, Credential, Pricing, Route, and Workspace Binding are
versioned control-plane facts. Secrets use database-managed versions or deployment
references. Production should mount `*_FILE` values or JSON maps rather than pass a
generic environment blob or frontend configuration.

OpenAI, Anthropic, Google, DeepSeek, and OpenAI-compatible transports preserve their
own required context and error protocols. An SDK does not own business retry,
fallback, budget, or settlement.

## Observability and deployment

- Pino JSON writes to stdout and stderr.
- OpenTelemetry export is optional and cannot change business state on failure.
- Docker BuildKit uses multistage Server, Worker, and Web targets.
- `pnpm deploy` produces isolated Server and Worker production dependency closures.
- Production containers run non-root, read-only, and without Linux capabilities.
- Compose keeps migration as an explicit one-shot task.

## Selection rule

A new dependency must directly complete a current user or runtime loop and explain:

1. Why the platform or installed dependencies are insufficient.
2. Which adapter or package owns it and how it stays out of Domain.
3. Bundle, startup, supply-chain, and license cost.
4. How tests and builds prove its boundary.
5. Whether replacement or removal affects a durable contract.

Do not add a framework, state library, generic plugin system, or second source of
business truth for hypothetical future reuse.
