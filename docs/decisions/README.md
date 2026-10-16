# Architecture decision records

ADRs preserve accepted long-term decisions that affect more than one module.

## Status

- **Accepted**: currently effective.
- **Partially Superseded**: a later ADR replaces only the named scope; the remaining
  decision stays effective.
- **Superseded**: replaced by a later ADR.
- **Proposed**: still under discussion and not an adopted decision.

## Records

| ADR                                                                         | Decision                                                                    | Status               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
| [0001](0001-ai-creative-operations-platform.md)                             | Position Kanvas as an AI creative operations platform                       | Superseded           |
| [0002](0002-three-execution-targets.md)                                     | Treat Browser, Worker, and remote Provider as peer execution targets        | Accepted             |
| [0003](0003-capability-driven-routing.md)                                   | Route implementations through provider-independent Capabilities             | Accepted             |
| [0004](0004-single-open-source-core.md)                                     | Share one open-source core across internal and self-hosted deployments      | Accepted             |
| [0005](0005-application-and-ui-foundation.md)                               | Use NestJS, Fastify, and a Studio-first Web baseline                        | Accepted             |
| [0006](0006-state-governance.md)                                            | Govern state by domain rather than one global state engine                  | Accepted             |
| [0007](0007-mysql-primary-database.md)                                      | Use MySQL as the sole primary relational database                           | Accepted             |
| [0008](0008-agent-ready-not-agent-first.md)                                 | Begin Agent-ready rather than Agent-first                                   | Superseded           |
| [0009](0009-versioned-skill-workflow-packages.md)                           | Separate Skill and Workflow with immutable publication                      | Accepted             |
| [0010](0010-unified-execution-facts-and-workflow-reliability.md)            | Unify execution facts and Workflow reliability semantics                    | Accepted             |
| [0011](0011-scenario-boundaries-and-first-party-canaries.md)                | Layer scenarios and retain first-party canaries                             | Accepted             |
| [0012](0012-content-assets-deliverables-and-editorial-selection.md)         | Separate object storage, Artifact, Asset, and deliverable selection         | Partially superseded |
| [0013](0013-v0-canary-batch-execution.md)                                   | Bound the initial batch-image canary and Browser fallback                   | Partially superseded |
| [0014](0014-drizzle-mysql-data-access-and-migrations.md)                    | Use Drizzle, mysql2, and explicit SQL migrations                            | Accepted             |
| [0015](0015-monorepo-module-and-build-boundaries.md)                        | Protect the modular monolith with pnpm, Turborepo, and dependency rules     | Accepted             |
| [0016](0016-lifecycle-scoped-contracts-and-http-api.md)                     | Use lifecycle-scoped contract authority and schema-driven HTTP APIs         | Accepted             |
| [0017](0017-bounded-workflow-runtime-and-database-owned-reliability.md)     | Use a bounded Workflow runtime with database-owned reliability              | Accepted             |
| [0018](0018-immutable-object-identity-and-transactional-artifact-commit.md) | Use immutable object identity and transactional Artifact commit             | Accepted             |
| [0019](0019-separated-authentication-and-workspace-authorization.md)        | Separate authentication from Workspace authorization                        | Accepted             |
| [0020](0020-versioned-config-secrets-and-provider-routing.md)               | Version configuration, secret references, and provider routes               | Accepted             |
| [0021](0021-bounded-observability-and-fenced-operations.md)                 | Bound observability and fence deployment recovery                           | Accepted             |
| [0022](0022-restricted-skill-package-import.md)                             | Restrict Skill-package import                                               | Accepted             |
| [0023](0023-target-gated-provider-invocation-reconciliation.md)             | Gate provider invocation by target and persist queryable facts              | Accepted             |
| [0024](0024-ephemeral-browser-executor-and-attempt-grant.md)                | Use ephemeral Browser executors, Attempt grants, and database leases        | Accepted             |
| [0025](0025-deliverable-work-session-business-bridge.md)                    | Connect deliverables and Workflows through explicit immutable facts         | Superseded           |
| [0026](0026-independent-workflow-identity-and-candidate-test-execution.md)  | Separate Workflow identity and run Candidate tests on one runtime           | Accepted             |
| [0027](0027-optional-provider-secret-encryption.md)                         | Support optional KEK encryption for provider secrets                        | Accepted             |
| [0028](0028-versioned-workspace-brand-context.md)                           | Version Workspace Brand Context                                             | Accepted             |
| [0029](0029-mastra-agent-runtime-spike.md)                                  | Isolate a Mastra Agent runtime spike                                        | Superseded           |
| [0030](0030-governed-mastra-agent-runtime.md)                               | Govern Mastra Agent runtime through Kanvas authority                        | Accepted             |
| [0031](0031-source-derived-capability-implementations.md)                   | Derive Capability implementations from verified model-source interfaces     | Accepted             |
| [0032](0032-agent-first-dynamic-skills.md)                                  | Make Agents primary and Skills dynamically discoverable                     | Accepted             |
| [0033](0033-system-managed-workspace-default-agent.md)                      | Manage the Workspace default Agent as system infrastructure                 | Accepted             |
| [0034](0034-platform-built-in-agent-tools.md)                               | Separate Platform Built-in Tools from business Tools                        | Accepted             |
| [0035](0035-retire-project-deliverable-and-converge-internal-formats.md)    | Retire Project and Deliverable Work Session and converge internal formats   | Accepted             |
| [0036](0036-account-only-registration-and-explicit-workspace-access.md)     | Register accounts without implicitly granting Workspace access              | Accepted             |
| [0037](0037-portable-image-deployment.md)                                   | Install one image with automatic or separately authorized database upgrades | Accepted             |

An accepted ADR is historical evidence, not the only current-fact document. When a
decision changes, add a superseding ADR and update the relevant current-fact
documentation instead of rewriting the accepted record silently.

ADRs 0001 through 0030 predate the English-first documentation baseline and retain
their original language. New and superseding ADRs use English.

- [ADR-0038: Administrator-configured default Workspace access](0038-default-workspace-access-for-self-registration.md)
- [ADR-0039: Preserve native Agent transcripts and settle Runs after model completion](0039-agent-model-transcripts-and-run-settlement.md)
- [ADR-0040: Share working references through Resource Libraries](0040-shared-resource-libraries.md)
