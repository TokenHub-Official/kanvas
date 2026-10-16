# Workflow execution and reliability

This document records current Workflow runtime facts, state machines, and recovery
protocols. See
[WORKFLOW-AUTHORING-AND-TEMPLATES.md](WORKFLOW-AUTHORING-AND-TEMPLATES.md) for
authoring and publication and
[ATOMIC-CAPABILITY-EXECUTION.md](ATOMIC-CAPABILITY-EXECUTION.md) for atomic terminal
commits.

## Authority

MySQL is the sole source of truth for Workflow, Node, Capability, Attempt, Outbox,
Inbox, Usage, Artifact, and cancellation state. Redis and BullMQ deliver rebuildable
work only; a queue job, lock, event, or log cannot advance business state.

The runtime has four levels:

```text
WorkflowRun
└── NodeRun (node + scope)
    └── CapabilityRun (logical invocation)
        └── CapabilityAttempt (one execution try)
```

A retry creates a new Attempt. A human retry of a terminal Workflow creates a new Run
with `retryOfWorkflowRunId`. Terminal facts never reopen.

## Revisions and nodes

WorkflowRun pins an immutable WorkflowRevision or PublicationCandidate, inputs, Brand
Context, and ExecutionPlanSnapshot. Definitions support four node kinds:

- `invoke`: one CapabilityRun;
- `map`: creates scoped NodeRuns for a bounded collection and aggregates them using
  `fail_fast` or `collect_all`;
- `switch`: selects an explicit branch and marks unselected branches `skipped`;
- `approval`: waits durably for a human decision without occupying a Worker.

Edges have explicit activation conditions and join semantics. Orchestrator advances a
bounded frontier per invocation; it does not open a transaction across the whole
Workflow or wake itself when no state changes.

## Value templates

Tagged value references resolve inputs, node outputs, and Workflow outputs. A
reference can read only allowed Workflow inputs, node outputs, and the current map
scope. It supports bounded JSON Pointer and executes no expression or code.

Runtime enforces hard limits for depth, node count, text size, map item count, and
final output schema. Author-side preflight improves feedback, while Server revalidates
at publication and Run creation.

## State machines

### WorkflowRun

```text
queued -> running <-> waiting -> completed | failed
queued | running | waiting -> cancelling -> cancelled
```

- `waiting` means only an undecided Approval remains.
- `completed` requires every required output to resolve and pass its schema.
- Outcome is `full_success`, `partial_success`, or `no_usable_output`.
- Every terminal state is irreversible.

### NodeRun

```text
pending -> running <-> waiting -> completed | failed
pending -> skipped
pending | running | waiting -> cancelled
```

### CapabilityRun

```text
queued -> running -> completed | failed | cancelled
```

`acceptedAttemptId` is set atomically from null to the current Attempt only.
`cancelRequestedAt` is an orthogonal intent and does not create another generic state
machine.

### CapabilityAttempt

```text
created -> running -> completed | failed | cancelled | abandoned
created -> cancelled
```

An Attempt also records:

- `sideEffectState`: `not_started`, `started`, `committed`, or `unknown`;
- `retryDisposition`: `retryable`, `terminal`, or `manual`.

`unknown` describes knowledge of an external side effect, not lifecycle status.

## Execution plan

Run creation pins:

- Workflow or Candidate and Capability Contract Revision;
- Implementation Revision, execution target, and candidate order;
- endpoint, model, pricing, Credential Version identity, and route policy;
- retry, timeout, budget, data-egress, and approval policy;
- initiator and a digest of the authorization decision at creation.

The snapshot never contains a secret, temporary signed URL, lease token, provider
access token, or queue ID. Attempt dispatch re-reads current authorization,
revocation, budget, and security policy; a stricter current fact blocks execution.

Retries within one CapabilityRun do not resolve the Binding again. Fallback advances
only through ordered candidates and reasons pinned in the snapshot.

## Dispatch, leases, and fencing

Execution Service creates an Attempt and Outbox record in one MySQL transaction. A
consumer reads the canonical Outbox and Attempt, then claims work against the current
execution generation, target, implementation, and lease conditions.

Heartbeat and completion must match Attempt ID, lease generation, token hash,
execution deadline, and runtime fence. An old Worker, browser assignment, or provider
invocation cannot overwrite a recovered Attempt even if it eventually returns.

Worker, Provider, and Browser share one execution kernel:

- Worker and Provider use their own BullMQ route dispatchers;
- Browser creates no queue dispatch and claims from MySQL through the authenticated
  browser control plane;
- all three enter the same atomic completion store at terminal state.

## Retry and unknown side effects

A Capability contract declares an idempotency mode:

- `intrinsic`: repeating the call is inherently safe;
- `keyed`: the upstream accepts a stable idempotency key;
- `non_idempotent`: safe repetition cannot be proven.

Only `intrinsic`, `keyed`, or a provably `not_started` non-idempotent Attempt can retry
automatically under the pinned policy. `non_idempotent + started/unknown` becomes
`manual` and cannot automatically replay or switch providers.

A provider timeout, broken stream, or process crash before persisting the request ID
does not prove that no execution occurred. Runtime records unknown effect and cost,
then converges through polling, callback, Reconciler, or manual recovery.

## Cancellation

Cancellation is accepted as a database command with actor, reason, deadline, and
Outbox record:

1. Orchestrator stops activating new edges.
2. Unclaimed Attempts cancel immediately.
3. Active execution receives an abort or cancel intent.
4. An Attempt without a trusted result after its deadline becomes `abandoned`.
5. Workflow becomes `cancelled` after active work converges.

MySQL commit order resolves races. If completion commits first, its Artifact remains
and downstream nodes stop. If cancellation commits first, the fence rejects late
completion. Cancellation does not erase historical Usage, Artifacts, or external cost.

## Outputs and partial success

A Workflow output is a named value selection. The outcome is `full_success` when all
required outputs are valid and no allowed partial failure remains; `partial_success`
when required output is valid but `collect_all` includes a failure or exclusion, or an
optional output is absent; and `no_usable_output` when no required usable output can
be formed.

A committed per-item Artifact is not deleted because packaging or another optional
node fails.

## Outbox, Inbox, and Redis recovery

```text
business transaction
-> Outbox(pending, availableAt)
-> Relay lease
-> BullMQ add(jobId = outboxEventId)
-> mark published
```

Enqueue and `publishedAt` cannot be atomic across MySQL and Redis, so duplicate
delivery is normal. A consumer uses a stable name and `(consumer_name, event_id)`
Inbox receipt, committing receipt and domain effect in one MySQL transaction. Payloads
carry identity and version only; consumers read the canonical Outbox record.

A permanent protocol error creates `queue_delivery_failure` or marks an Outbox record
`quarantined`; an old execution generation becomes `superseded`. Temporary database
and infrastructure errors are not permanent poison.

Reconciler scans bounded MySQL ranges for:

- unpublished Outbox records;
- current Attempts without dispatch;
- Attempts with expired leases or deadlines;
- Runs without terminal convergence events;
- `cancelling` Runs and unprocessed cancellation events.

Repair invokes normal commands and creates new Outbox records; it never fabricates
queue state. After Redis is cleared, rebuild only nonterminal work, not historical
terminal jobs.

## Database invariants

- Node identity is `(workflow_run_id, node_key, scope_key)`.
- Attempt number is unique within a CapabilityRun.
- Attempt output role and index are unique.
- Every state transition carries an expected state or version.
- Transactions holding the CapabilityRun version update `currentAttemptId` and
  `acceptedAttemptId`.
- Approval Decision, Inbox Receipt, and applicable Outbox aggregate versions are
  unique.
- Terminal states never regress.

## Verification boundary

Repository unit tests cover topology, value references, state transitions, error
mapping, and queue protocols. The disposable MySQL suite covers migrations,
compare-and-swap, concurrent completion, cancellation races, Inbox and Outbox,
Reconciler, Provider, Browser, Storage, and Artifact commit.

These tests do not prove execution against a real external provider, billed cost,
remote callback behavior, a telemetry backend, multi-node volume failure, or a restore
drill. Validate those separately with governed accounts and target infrastructure for
the relevant release.

## Code locations

- `packages/application/src/modules/workflow/`: Revisions, values, Runs, and state
  protocols.
- `packages/database/src/runtime/workflow-*.ts`: execution, convergence, and query
  stores.
- `packages/database/src/runtime/attempt-completion-store.ts`: atomic terminal commit.
- `apps/worker/src/`: Orchestrator, Execution, Provider, and Reconciler.

See
[ADR-0017](decisions/0017-bounded-workflow-runtime-and-database-owned-reliability.md)
and
[ADR-0023](decisions/0023-target-gated-provider-invocation-reconciliation.md) for the
durable decisions.
