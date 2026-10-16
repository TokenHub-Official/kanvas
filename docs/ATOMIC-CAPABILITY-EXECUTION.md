# Atomic Capability completion

This document records the terminal commit boundary shared by Worker, Provider, and
Browser Capability Attempts. See [WORKFLOW-EXECUTION.md](WORKFLOW-EXECUTION.md) for the
complete Workflow state machine and
[STORAGE-AND-UPLOADS.md](STORAGE-AND-UPLOADS.md) for object commit and storage.

## Layers

- An **Editor Command** changes the current editor document and is undoable and bound
  to its current version.
- A **Capability** is a routable, billable, auditable unit of atomic execution.
- A **Workflow or Skill** composes Capabilities, conditions, human approval, and data
  mapping.

A convenient UI action may invoke a Capability but cannot duplicate execution,
billing, or Artifact-commit logic.

## Completion preconditions

An Attempt can complete only when all conditions hold:

1. Runtime allows completion and `executionGeneration` matches the current fence.
2. The Attempt is current for CapabilityRun and its lifecycle permits the terminal
   transition.
3. Lease generation, token hash, and execution-target identity remain valid.
4. Implementation Revision, digest, adapter, and pinned execution plan match.
5. Provider invocation or Browser assignment facts prove that the corresponding
   execution succeeded.
6. Every output object has been uploaded, sealed, verified, and belongs to the same
   Workspace.
7. Output count, metadata, Usage, and monetary values pass bounded validation.

Worker, Provider, and Browser use distinct target identities but enter the same
`AtomicAttemptCompletionStore`. Callers cannot omit or interchange target-specific
fields.

## One-transaction commit

The completion transaction writes together:

- Attempt completion manifest;
- StoredObject-to-Artifact commit facts;
- Attempt outputs and Capability outputs;
- initial Usage observations or unknown entries;
- advanceable Attempt, CapabilityRun, NodeRun, and WorkflowRun state;
- terminal Outbox and control-plane Audit.

Any failure rolls back the entire operation. There is no compatibility path that marks
success before adding Artifact, Usage, or Outbox records later.

## Idempotency and conflicts

The canonical completion-manifest hash covers the Attempt, target identity, outputs,
and Usage.

- The first successful call returns `completed`.
- A replay with the same Attempt and manifest returns `replayed`.
- A request with the same idempotency identity but a different manifest returns
  `manifest_conflict`.
- An old lease, old fence, noncurrent Attempt, or object-ownership mismatch returns its
  own stable error code.

A caller may replay only an identical completion request. An unknown side effect enters
observation or manual recovery; it must not be hidden by constructing a new Attempt.

## Usage boundary

Usage sources are distinct:

- `producer_reported`;
- `provider_reported`;
- `kanvas_measured`;
- `kanvas_calculated`.

Quantity and money use decimal strings so JavaScript Number cannot lose precision. A
provider-reported price is not automatically a Kanvas-verified charge; Pricing
Revision, evidence digest, and settlement state remain explicit.

## Canvas preview and application

A Capability output first becomes an immutable Artifact. Applying it to Canvas uses a
separate Editor Command that records source Artifact, target element, and document
version. A preview is not committed output, and application never mutates the source
Artifact.

Canvas may change while long-running work is in progress. Application detects a
missing target, version conflict, permission revocation, or page change and lets the
user choose a new target or keep the result. It never silently overwrites the current
document.

## Code locations

- `packages/database/src/runtime/attempt-completion-store.ts`: atomic completion store.
- `packages/database/src/runtime/workflow-engine-store.ts`: Attempt lifecycle and
  claims.
- `packages/application/src/modules/workflow/`: execution plans and state protocols.
- `apps/worker/src/`: completion callers for each execution target.

A new execution target extends target identity and completion preconditions. It does
not restore the deleted generic direct-completion interface.
