# Kanvas documentation

This directory contains three kinds of long-lived documentation: current facts,
durable operating guides, and architecture decisions. Phase plans, batch evidence,
one-off audits, screenshot indexes, and completed checklists do not belong here;
their evidence remains in code, tests, issues, and Git history.

## Getting started and operations

- [DEVELOPMENT.md](DEVELOPMENT.md): local setup, startup, generation, and verification
- [CONFIGURATION.md](CONFIGURATION.md): component-scoped environment variables,
  requirements, defaults, and structured configuration boundaries
- [REPOSITORY-STRUCTURE.md](REPOSITORY-STRUCTURE.md): monorepo modules and dependency
  direction
- [OBSERVABILITY-AND-OPERATIONS.md](OBSERVABILITY-AND-OPERATIONS.md): health,
  telemetry, recovery, and production operations
- [Docker deployment](../deploy/README.md): images, Compose, secrets, and upgrades

## Product and interface

- [PROJECT.md](PROJECT.md): product position, users, and scope
- [PRODUCT-UI-ARCHITECTURE.md](PRODUCT-UI-ARCHITECTURE.md): current pages and user
  journeys
- [PRODUCT-UI-EXPERIENCE-NORTH-STAR.md](PRODUCT-UI-EXPERIENCE-NORTH-STAR.md):
  long-term interface principles
- [Kanvas design language](../DESIGN.md): visual tokens and component conventions
- [ROADMAP.md](ROADMAP.md): uncommitted directions and contribution priorities

## Platform facts

- [ARCHITECTURE.md](ARCHITECTURE.md): platform layers, domain objects, and state
  governance
- [API-CONTRACTS.md](API-CONTRACTS.md): contract authority, OpenAPI, and generation
- [DATA-ACCESS.md](DATA-ACCESS.md): MySQL, Drizzle, transactions, and migrations
- [IDENTITY-AND-AUTHORIZATION.md](IDENTITY-AND-AUTHORIZATION.md): authentication,
  authorization, and workspace boundaries
- [STORAGE-AND-UPLOADS.md](STORAGE-AND-UPLOADS.md): objects, artifacts, uploads, and
  garbage collection
- [ARTIFACT-PREVIEW-STRATEGY.md](ARTIFACT-PREVIEW-STRATEGY.md): preview generation
  strategy

## Execution and extension

- [CAPABILITIES.md](CAPABILITIES.md): capability model and execution targets
- [ATOMIC-CAPABILITY-EXECUTION.md](ATOMIC-CAPABILITY-EXECUTION.md): atomic execution
  boundaries
- [WORKFLOW-EXECUTION.md](WORKFLOW-EXECUTION.md): workflow state machine, attempts,
  and recovery
- [WORKFLOW-AUTHORING-AND-TEMPLATES.md](WORKFLOW-AUTHORING-AND-TEMPLATES.md):
  authoring and publication model
- [AGENT-PRODUCT-AND-RUNTIME-V1.md](AGENT-PRODUCT-AND-RUNTIME-V1.md): Agent product
  and runtime boundaries
- [PROVIDER-RUNTIME.md](PROVIDER-RUNTIME.md): provider protocols and context
  continuity
- [MODEL-SERVICE-CONTROL-PLANE-V1.md](MODEL-SERVICE-CONTROL-PLANE-V1.md): model
  control plane and billing facts
- [CONFIG-SECRETS-PROVIDERS.md](CONFIG-SECRETS-PROVIDERS.md): versioned
  configuration, secrets, and providers
- [BROWSER-RUNTIME-CONTROL-PLANE.md](BROWSER-RUNTIME-CONTROL-PLANE.md): browser
  execution control plane
- [SKILL-PACKAGE-SECURITY.md](SKILL-PACKAGE-SECURITY.md): skill-package security
  boundaries
- [CAPABILITY-AUTHORING-DECLARATION-V1.md](CAPABILITY-AUTHORING-DECLARATION-V1.md):
  capability declarations
- [CAPABILITY-SEMANTIC-PORTS-V1.md](CAPABILITY-SEMANTIC-PORTS-V1.md): semantic
  ports
- [EXTERNAL-RESOURCE-SOURCES-V1.md](EXTERNAL-RESOURCE-SOURCES-V1.md): external
  resource sources and adoption
- [WORKSPACE-BRAND-CONTRACT-V1.md](WORKSPACE-BRAND-CONTRACT-V1.md): versioned brand
  context

## Architecture decisions

[decisions/](decisions/README.md) contains adopted and superseded architecture decision
records. When an established decision changes, add a superseding ADR and update the
relevant current-fact documentation. Do not silently rewrite the historical decision.
