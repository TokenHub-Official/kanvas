# Workflow authoring, templates, and publication

This document records the current Workflow authoring model. See
[WORKFLOW-EXECUTION.md](WORKFLOW-EXECUTION.md) for runtime state and reliability and
[CAPABILITIES.md](CAPABILITIES.md) for Capability input and routing.

## Object model

| Object               | Responsibility                                     |
| -------------------- | -------------------------------------------------- |
| Workflow             | Stable Workspace identity, name, catalog lifecycle |
| WorkflowDraft        | Mutable working copy with optimistic version       |
| PublicationCandidate | Immutable review object from one Draft version     |
| WorkflowRevision     | Immutable formal version created after approval    |
| WorkflowTemplate     | Discoverable entry to a published Revision         |

A production Run pins WorkflowRevision. A prepublication test pins
PublicationCandidate. Both use the production Workflow runtime: there is no second
test executor and a Candidate never masquerades as a published Revision.

## Authoring semantics

Definitions currently support:

- `invoke`: call a published Capability Binding;
- `switch`: choose a branch with a bounded expression;
- `map`: create recoverable scoped executions for a bounded collection;
- `approval`: wait for an authorized human decision;
- parallel branches with explicit joins;
- bounded data mapping from Workflow input or upstream terminal output.

Authors save a declarative definition. Provider, Credential, Workspace ID, lease, and
runtime route do not enter the Draft. Current policy resolves them at Run creation and
pins the resulting execution plan.

## Editing and concurrency

Create, update, and archive commands require Workspace authority and expected version.
A version mismatch returns a conflict. The client re-reads and lets the author resolve
differences instead of applying last-write-wins.

The editor may provide a node catalog, schema-driven fields, connections, and static
validation, but the diagram is not authority. Save sends a canonical Workflow
definition; Server revalidates topology, ports, mapping, resource limits, and
Capability availability.

## Candidates, tests, and publication

Candidate creation pins Draft version, definition digest, and every Revision needed
for publication. Candidate content never changes in place.

A test Run:

1. Pins Candidate and test input.
2. Creates a Run through the production Workflow state machine.
3. Records Attempts, Usage, Artifacts, cancellation, and recovery facts.
4. Links results to Candidate review without consuming a production Revision number.

Publication requires successful Candidate validation and review. One transaction
creates the immutable WorkflowRevision and updates Workflow's current pointer. Later
maintenance starts a new Draft from a published version rather than editing it.

## Templates and ordinary use

The template catalog contains only effective published Workflows the current user may
run. A template provides a user-facing name, purpose, input schema, and expected
result. It does not expose internal node IDs, provider routes, or credentials.

Starting from a template creates either a Run or an author Draft, depending on the
chosen action. A template does not copy an Artifact, Brand, or external resource. Run
creation pins the actual Revision and context.

## Authority

Catalog read, Draft edit, test Run, review submission, publication approval, and
Workflow archive are separate permissions. Server reads current authority when a
command executes; hiding a client button is not authorization.

Publication and archive write Audit. Revoked permission or Revision, or an unavailable
Capability, fails new Runs closed. Historical Runs retain pinned facts for explanation.

## Errors and recovery

- A schema or topology error returns stable node- and field-level problems and never
  saves a half-valid Draft.
- A Draft version conflict requires re-read.
- A failed Candidate test retains its Run and Artifacts and allows a later Candidate
  from the original Draft.
- Transaction and uniqueness constraints prevent two equal published versions during
  a race.
- Run failure, cancellation, and unknown external effects follow Workflow Runtime
  rather than an authoring-page interpretation.

## Code locations

- `packages/application/src/modules/workflow-authoring/`: Draft commands and
  declaration projection.
- `packages/application/src/modules/workflow-catalog/`: template catalog and effective
  invocation schema.
- `packages/database/src/runtime/publication-*.ts`: Candidate, review, and publication
  persistence.
- `apps/server/src/http/`: Workflow authoring and catalog HTTP entry points.
- `apps/web/src/features/workflows/`: authoring editor and test-result interface.

See
[ADR-0026](decisions/0026-independent-workflow-identity-and-candidate-test-execution.md)
for the durable identity and Candidate-test decision.
