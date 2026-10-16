# ADR-0035: Retire Project and Deliverable Work Session and converge internal formats

- Status: Accepted
- Date: 2026-09-15
- Supersedes: the Project, Brief, ProjectDeliverable, DeliverableItem, and Deliverable
  Work Session portions of [ADR-0001](0001-ai-creative-operations-platform.md),
  [ADR-0004](0004-single-open-source-core.md),
  [ADR-0007](0007-mysql-primary-database.md),
  [ADR-0012](0012-content-assets-deliverables-and-editorial-selection.md), and
  [ADR-0013](0013-v0-canary-batch-execution.md); fully supersedes
  [ADR-0025](0025-deliverable-work-session-business-bridge.md)

## Context

The development-era Project and Deliverable Work Session model did not form a current
creation, collaboration, or recovery journey. Its HTTP contracts were unreachable,
while its modules, tables, fields, and `project.read` / `project.write` permissions
continued to burden Canvas, Asset, and execution code. The same pre-release history
also left several Kanvas-owned persisted and wire formats at internal version 2 or 3,
despite there being no supported external compatibility obligation.

## Decision

1. Project, Brief, ProjectDeliverable, DeliverableItem, and Deliverable Work Session
   are retired from the current product and codebase. Their HTTP routes, permissions,
   Application modules, stores, schema, fields, and tables have no compatibility
   alias or dual-read path.
2. Canvas uses `canvas.read` and `canvas.write`. Asset operations use `asset.read` and
   `asset.write`. A Workspace and exact resource identity remain the authorization
   boundary.
3. Canvas Draft, Artifact, Asset, Brand Revision, Workflow Revision and Run, Agent,
   Skill, approval, and ActionReceipt remain distinct current facts. Artifact lineage,
   Asset editorial selection, Workflow results, and explicit human decisions preserve
   acceptance and reuse without recreating a Deliverable object under another name.
4. Every current Kanvas-owned internal schema or protocol in this consolidated
   pre-release baseline uses version 1 with its complete current semantics. This
   includes Agent-visible messages, Workflow topology, pinned execution plans, Model
   Profiles, Provider route snapshots, and Attempt Completion Manifests. Production
   readers reject other internal format versions; compatibility wrappers and fallback
   parsers are not retained for discarded development data.
5. Internal format version is separate from business and concurrency identity.
   Immutable content Revisions, optimistic `expectedVersion`, execution generations
   and fences, catalog content releases, third-party SDK versions, Provider API
   surfaces, and Adapter identities retain their actual values and meanings.
6. The development migration chain is replaced by one data-free initial schema after
   the current structures settle. Existing development databases are rebuilt instead
   of receiving a compatibility migration from the retired model or formats.
7. Historical ADR bodies remain unchanged as evidence of earlier decisions. Their
   status and supersession links direct maintainers to this current boundary.

## Consequences

- A future production-order or delivery object requires its own proven user actions,
  ownership, permissions, lifecycle, and recovery journey. It must not inherit the
  retired Project model by default.
- Generated contracts, fixtures, digests, readers, writers, documentation, and the
  initial database schema must agree on each current V1 format.
- Migration integrity, immutable publication, optimistic concurrency, execution
  fencing, and exact third-party protocol admission remain required safety controls;
  format convergence does not weaken them.
