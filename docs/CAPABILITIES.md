# Capability model

A Capability is a stable provider-independent business ability. Pages, Workflows, and
Agents invoke the same contract; a button, model name, or provider endpoint is not a
Capability identity.

## Fact model

| Object                       | Responsibility                                           |
| ---------------------------- | -------------------------------------------------------- |
| Capability Contract Revision | Input, output, idempotency, risk, data, caller semantics |
| Implementation Revision      | Adapter, execution target, configuration, digest         |
| Binding                      | Workspace-enabled contract, implementation, and route    |
| Route Policy Revision        | Ordered candidates, retry, fallback, budget, region      |
| CapabilityRun                | One logical invocation                                   |
| CapabilityAttempt            | One real execution, lease, and side-effect facts         |

A published Contract or Implementation is immutable. To change an ability, model, or
adapter, publish a new Revision and update the Binding explicitly.

Changing only a model, service, Runtime Adapter, or field mapping publishes another
Implementation Revision while the public Contract stays fixed. Discovery metadata
edits publish another Declaration Revision against that same Contract.

The first release does not expose a public Contract-update path. Definition creation
publishes Contract Revision 1; current administration can revise metadata and run
methods, but it cannot create or switch to Contract Revision 2. An additive Contract
change is only a compatibility candidate, and a breaking change requires a future
evolution protocol with impact review and new pinned Workflow Revisions. That protocol
is a requirement once a released Contract must change, not an implemented migration
plan, API, table, compatibility runtime, or UI.

Published Workflow content pins the exact Contract key, Revision, and digest. A
WorkflowRun pins its Workflow Revision, and its ExecutionPlanSnapshot pins the selected
Contract and route candidates. Later administration never rewrites those facts.

## Execution targets

- `browser`: Web Worker, WASM, WebGPU, or browser algorithm that claims an Attempt
  through the browser control plane.
- `worker`: internal deterministic algorithms, OCR, media processing, and governed
  local models.
- `provider`: remote services invoked through a governed HTTP adapter.

One Contract may have multiple Implementations, but every Run's
ExecutionPlanSnapshot pins the actual candidate order. Runtime never re-reads a mutable
Binding to change that order.

## Required contract semantics

- stable `contractKey` and revision;
- bounded input, output, and error schemas;
- explicit `supportedInvokers` set of `user`, `workflow`, and `agent`;
- idempotency and cancellation semantics;
- input and output Artifact roles;
- data classification and allowed execution targets;
- network and secret requirements;
- budget, maximum charge, and Usage units;
- side-effect, retry, and fallback limits;
- human approval policy.

Capability names and descriptions use business language and do not expose providers,
database details, or tool orchestration.

## ToolView

An Agent does not see every Capability. Each model step derives a bounded ToolView
from the intersection of:

```text
supportedInvokers
∩ Workspace grant
∩ current user authority
∩ data classification and egress policy
∩ current Binding and execution-target health
∩ budget and maximum charge
∩ approval policy
```

ToolView may narrow fields and enum values; it cannot expand a Contract or authority.

## Execution invariants

- A CapabilityRun adopts at most one Attempt.
- Every Attempt has an absolute deadline, lease, and execution generation.
- A retry stays on its candidate; fallback advances only for snapshot-declared
  reasons.
- An unknown side effect does not automatically retry or advance.
- Output is sealed and verified before one transaction creates StoredObject, Artifact,
  Usage, and Outbox facts.
- Provider Usage, Agent model Usage, and internal-compute Usage remain separate.
- Agent, Workflow, and human invocation share execution facts rather than separate
  state machines.

## Current capability families

Current code includes stable boundaries for:

- image generation, expansion, object removal, upscaling, enhancement, and background
  processing;
- OCR and text extraction;
- browser image adjustment and governed browser execution;
- Workflow composition as a Capability;
- Canvas commands and Artifact insertion;
- Agent query, Canvas command, Capability, and Workflow tools.

Actual availability is the intersection of published contracts, current Workspace
bindings, model catalog, and runtime health. This document intentionally avoids an
easily stale tool inventory.

## Admitting a new capability

1. Define a business contract rather than projecting provider parameters.
2. Provide deterministic schema, errors, and Artifact semantics.
3. Declare authority, data egress, budget, and side effects.
4. Publish at least one Implementation Revision.
5. Pass the minimum Contract, Application, Store, and real-target tests.
6. Add it to a page or Agent ToolView only when a real user flow needs it.

See
[CAPABILITY-AUTHORING-DECLARATION-V1.md](CAPABILITY-AUTHORING-DECLARATION-V1.md) for
author declarations and
[ATOMIC-CAPABILITY-EXECUTION.md](ATOMIC-CAPABILITY-EXECUTION.md) for execution.
