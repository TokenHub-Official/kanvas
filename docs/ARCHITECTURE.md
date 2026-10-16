# Platform architecture

This document records platform facts that current code must follow. Historical and
superseded choices live in [architecture decision records](decisions/README.md).
Implementation batches, screenshots, and acceptance evidence do not belong here.

## Principles

1. **Workflow first**: versioned Workflows express user-facing production processes;
   tool lists do not.
2. **Artifact first**: inputs, outputs, and human revisions create immutable Artifacts
   with explicit lineage.
3. **Capability first**: business logic depends on stable capability contracts, not
   provider names or raw APIs.
4. **Database authority**: MySQL stores business facts; Redis, queues, caches, and
   in-process objects are rebuildable.
5. **Governed Agent**: an Agent handles uncertainty, while Kanvas retains authority
   over permissions, budgets, execution, billing, and audit.
6. **Explicit adoption**: an external resource first becomes a provenance-bearing
   Artifact and becomes a team Asset only after an explicit save action.
7. **Open-source parity**: self-hosted and internal deployments use the same domain
   model and core code.

## Logical components

```text
Web
  -> Server / Application use cases
      -> MySQL
      -> Transactional Outbox
          -> Redis / BullMQ
              -> Worker
                  -> Browser | Worker Adapter | Provider Adapter
                      -> StoredObject -> Artifact
```

- `apps/web`: React workbench, Canvas, Workflow, Agent, and administration UI.
- `apps/server`: NestJS/Fastify HTTP, authentication, authorization, and Application
  composition root.
- `apps/worker`: orchestration, execution, providers, Outbox Relay, scheduling,
  recovery, and maintenance roles.
- `packages/contracts`: cross-process TypeBox schemas, route contracts, and generation
  authority.
- `packages/application`: transport- and database-independent use cases, policies,
  and domain validation.
- `packages/database`: MySQL schema, transactional stores, migrator, and runtime
  persistence.
- `packages/agent-runtime`: governed Mastra adapter, model ports, and dynamic ToolView.
- `packages/storage` and `packages/secrets`: controlled infrastructure ports for
  objects and secrets.

Architecture checks enforce dependency direction: Application does not depend on
Database or Apps, Contracts does not depend on runtime packages, and Apps contain
composition and transport adapters only.

## Authoritative facts

| Domain     | Authoritative facts                                                        |
| ---------- | -------------------------------------------------------------------------- |
| Tenancy    | Organization, Workspace, Principal, Membership, ServiceGrant               |
| Content    | StoredObject, Artifact, Asset, ArtifactReference, ArtifactEdge             |
| Brand      | BrandKit, immutable BrandKitRevision, Canvas-pinned Brand Revision         |
| Publishing | Draft, PublicationCandidate, ReviewDecision, immutable Revision            |
| Workflow   | WorkflowRevision, WorkflowRun, NodeRun, ExecutionPlanSnapshot              |
| Capability | ContractRevision, ImplementationRevision, Binding, CapabilityRun, Attempt  |
| Agent      | Thread, Branch, Message, Run, ModelCall, Tool Receipt, Memory Observation  |
| Cost       | Budget Reservation, Provider Usage, Usage Ledger, Settlement               |
| Operations | Outbox, Inbox Receipt, InstanceRuntimeState, AuditEvent, RecoveryOperation |

Published Revisions and committed Artifacts are never edited in place. New content,
policy, or implementation creates a new Revision; revocation changes a separate
lifecycle fact.

## Workflow and Capability execution

```text
WorkflowRevision
-> WorkflowRun
-> ExecutionPlanSnapshot
-> NodeRun
-> CapabilityRun
-> CapabilityAttempt
-> StoredObject
-> Artifact
```

- Workflow topology accepts only `kanvas.workflow-topology.v1`.
- Every Run pins contracts, implementations, provider models, parameter policy, and
  an ordered route.
- Attempts use database leases, generation fences, and absolute deadlines.
- A CapabilityRun adopts at most one Attempt; late results cannot overwrite adopted
  facts.
- A retry repeats the current candidate. Fallback advances only for declarative
  reasons captured in the snapshot.
- Completing an Attempt and advancing its Node or Workflow are separate transaction
  boundaries, preventing duplicate settlement and output.
- MySQL transactions commit Outbox records with business state; queue state never
  substitutes for business state.

See [WORKFLOW-EXECUTION.md](WORKFLOW-EXECUTION.md) and
[ATOMIC-CAPABILITY-EXECUTION.md](ATOMIC-CAPABILITY-EXECUTION.md) for the complete
protocols.

## Execution targets

- **Browser**: a trusted session registers capabilities and claims Attempts with a
  short-lived grant. Model and runtime assets are pinned by version and digest.
- **Worker**: performs deterministic media processing, OCR, internal model calls, and
  maintenance work.
- **Provider**: invokes a remote service through an explicit adapter, endpoint,
  SecretVersion, budget, and network policy.

Business code cannot access provider secrets or provider HTTP directly. Selection is
first captured in ExecutionPlanSnapshot; runtime then resolves the pinned
SecretVersion.

## Agent runtime

Kanvas uses a governed Mastra Agent runtime:

- `@kanvas/agent-runtime` is the only Workspace package with a direct Mastra
  dependency.
- Mastra owns the in-process model loop, stream events, and tool adapter, not durable
  business state.
- Agent model calls use `AgentModelRuntime` with a Workspace-pinned logical model and
  write separate ModelCall, Attempt, Usage, and budget facts.
- ToolView is derived from permissions, data classification, budget, binding health,
  and approval policy.
- Query tools, Canvas commands, Capabilities, and Workflows enter their own Application
  boundaries.
- Canvas changes are validated, undoable commands; an Agent never writes the document
  directly.
- Mastra Memory Processor creates bounded observations; Kanvas stores and rehydrates
  them.

An Agent model call does not fabricate a WorkflowRun or CapabilityRun, and it does not
duplicate provider usage, Artifact, or billing facts already owned downstream. See
[AGENT-PRODUCT-AND-RUNTIME-V1.md](AGENT-PRODUCT-AND-RUNTIME-V1.md) and
[ADR-0030](decisions/0030-governed-mastra-agent-runtime.md).

## Canvas and content

- Canvas persistence accepts only `kanvas.editor-document/v1`.
- Canvas drafts use optimistic concurrency, immutable historical revisions, and
  explicit recovery.
- Canvas pins internal Artifacts and Revisions, never provider URLs.
- Adding an external image or SVG creates a provenance-bearing Artifact; saving it to
  the asset library is a separate user action.
- StoredObject is a physical object fact, Artifact is immutable business content, and
  Asset is a user-managed logical asset.

## Identity and security

- Better Auth owns authentication sessions; Kanvas owns Principal, Membership, and
  permissions.
- Every Workspace HTTP request reconstructs trusted authorization context and ignores
  client-supplied Actor or Workspace authority.
- CSRF, service tokens, SecretVersions, provider egress, and Artifact downloads each
  have independent validation.
- Logs, traces, audits, and ordinary APIs do not record secrets, cookies, prompts,
  user content, or raw provider payloads.

## Operations and deployment

- Server, Worker, and Web build independently. Production containers run non-root
  with read-only filesystems.
- MySQL is the persistent source of truth; Redis contains only rebuildable queue
  state.
- Migrations are an explicit release step and never run automatically at application
  startup.
- The first public version creates the complete database through one
  `0000_initial_schema.sql`, without development migration history.
- Health checks distinguish live from ready; production can split Worker roles.
- A backup covers database, objects, schema, secret references, and image versions,
  not only MySQL.

See [DEVELOPMENT.md](DEVELOPMENT.md) for local, CI, and container commands and
[OBSERVABILITY-AND-OPERATIONS.md](OBSERVABILITY-AND-OPERATIONS.md) for deployment and
recovery.

## Change rules

- Add an ADR when changing a cross-process contract, domain authority, execution
  semantic, or persistence invariant.
- Update this document and the relevant specialist document when a current fact
  changes.
- Keep phase plans, implementation logs, screenshots, one-off reviews, and test output
  out of long-lived documentation.
- Code, generated contracts, database constraints, and automated checks outrank stale
  prose. Fix conflicting documentation instead of adding compatibility code to hide
  the conflict.
