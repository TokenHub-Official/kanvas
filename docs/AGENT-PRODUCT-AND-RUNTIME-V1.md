# Agent product and runtime

Status: accepted Agent-first target; implementation is in progress. The current code
still routes user messages through one Main Agent until the Agent identity and Skill
library phases land.

This document records the Agent product responsibilities, durable facts, and
framework boundary. See
[PRODUCT-UI-EXPERIENCE-NORTH-STAR.md](PRODUCT-UI-EXPERIENCE-NORTH-STAR.md) for general
interface principles and
[MODEL-SERVICE-CONTROL-PLANE-V1.md](MODEL-SERVICE-CONTROL-PLANE-V1.md) for model and
provider facts.

## Product responsibility

Kanvas provides one system-managed Built-in Default Agent and many explicit
Workspace-managed Custom Agents. Agent is the primary unit users discover and assign
work to. One Thread belongs to exactly one Agent. Different entry points supply
bounded surface context; they do not create isolated page-specific bots or silently
switch the Thread's Agent.

The Built-in Default Agent is Workspace infrastructure, not user-authored content. It
keeps a normal stable Agent identity and immutable Profile Revisions for Thread, Run,
and audit references, while system code owns its identity, core instructions, Tool
Family policy, first-party bindings, visibility, activation, and lifecycle. Workspace
model, reasoning, web-search, and ordinary-action confirmation settings remain
separate configurable facts. Ordinary Agent management cannot edit, transfer, hide,
archive, delete, disable, or republish the Built-in Default Agent.

Workspace creation establishes the Built-in Default Agent transactionally, even
when no model is configured. Authorized Agent entry points also repair an existing
Workspace that is missing this infrastructure. Initialization is idempotent and
preserves existing profiles, surface bindings, model choices, and credentials.
Registering an account or granting a Membership does not create another Workspace
or another Agent.

Agent identity readiness and model readiness are separate. A Workspace without an
available default model shows a configuration action to administrators and a waiting
state to members. New default-Agent requests are rejected before creating a Thread
or Run until a model is available. Configuration uses this Workspace's authorized
model catalog; initialization does not copy credentials or model routes from another
Workspace or silently choose an unconfigured site-wide model.
For an empty model catalog, the setup path is Provider connection, model import,
then selection of the Agent's default and fast models. Each empty state points to
the next available step rather than leaving an unexplained disabled control.

Designers can publish an Agent from a user-facing summary, System Prompt, and bound
discovery metadata for Skills, Brand, and Workflows. A binding makes metadata
immediately visible but does not require use, narrow the Thread's work, or prevent
discovery of other authorized objects. Downstream operators can use that published
Agent without gaining authority to modify its configuration.

The Agent can:

- understand a user's goal, current Workspace, and explicitly attached resources;
- query work, assets, Workflows, and brand context the current user may read;
- dynamically project authorized Canvas commands, Workflows, and governed tools;
- present progress, results, cost impact, and actions requiring a user decision;
- recover from durable facts after refresh, failure, revocation, or branch changes.

The Agent does not bypass existing business boundaries. It cannot read provider
secrets directly, write the database, mutate internal Canvas state, or present a model
suggestion as an executed fact.

## User-visible objects

- **Built-in Default Agent**: the single system-managed Workspace teammate used when
  no Custom Agent is selected. The interface presents it separately and never assigns
  it a human creator.
- **Custom Agent**: a stable Workspace-managed teammate with a user-facing summary,
  core instructions, visibility, and published configuration.
- **Skill**: a reusable work method whose Markdown Instructions teach the Agent an SOP;
  they are guidance, not an executable Workflow.
- **Thread**: a stable `AgentThread` that can be renamed, archived, branched, and
  recovered and belongs to exactly one Agent Revision until explicitly upgraded.
- **Message**: immutable visible content submitted by a user or Agent at a point in
  time.
- **Run context**: explicit message attachments plus the exact resources and Skill
  revisions read while serving one Run. It records what the Agent could see; it is not
  a Brand, Skill, or Workflow scope for the Thread.
- **Action**: an executable operation proposed by the Agent; when confirmation is
  required, its result or consequence is shown first.
- **Result**: a committed Canvas change, Workflow Run, Artifact, or another business
  object, not chat text.

Messages preserve what happened at the time; current context reflects the latest
available facts. The interface does not present an old message as current object
state or expose internal tool names, providers, credentials, budget reservations, or
database IDs in the primary journey.

## Durable facts

MySQL owns Agent business state:

| Fact                                   | Responsibility                                         |
| -------------------------------------- | ------------------------------------------------------ |
| `Agent` / `AgentRevision`              | Stable identity, published behavior, default bindings  |
| `AgentThread`                          | Thread identity, lifecycle, current branch, history    |
| `AgentRun`                             | One processing cycle, context snapshot, outcome        |
| `AgentModelCall` / `AgentModelAttempt` | Model invocation, route, failure, tokens, and cost     |
| `AgentActionReceipt`                   | Proposal, approval, execution, final-result reference  |
| `AgentInteraction`                     | User-input request, response, and durable continuation |
| `AgentRunSkillUse`                     | Exact Skill Revision read by one Run, not causal usage |
| Thread memory                          | Bounded observations; never replaces messages or facts |

Mastra in-process objects, stream events, and Memory Processor are not business
authority. After a process restart, runtime rebuilds from Kanvas facts rather than
guessing from framework memory.

## Runtime boundary

`@kanvas/agent-runtime` is the only Workspace package allowed to depend directly on
Mastra. Mastra owns the in-process model loop, tool adapters, and stream protocol.
Kanvas continues to own:

- Workspace authorization, ToolView eligibility, and execution-time reauthorization;
- provider endpoints, credentials, model bindings, and secret resolution;
- budget reservation, Usage, Charge, and Audit;
- Agent, Workflow, Capability, Attempt, Artifact, Asset, and Brand facts;
- canonical validation, idempotency, cancellation, and recovery.

After Worker claims an `AgentRun`, it builds ToolView from the pinned context and
current permissions, then enters the governed model path through
`KanvasAgentModelPort`. A framework model router or provider SDK is not an alternate
path.

## Model calls

Before remote I/O, the governed model port:

1. Resolves the Workspace's current Agent model binding.
2. Validates model capabilities and Run controls.
3. Creates ModelCall, Attempt, and budget-reservation facts.
4. Resolves a secret-scoped transport.
5. Pins request digest and provider route facts.

After the call, it records normalized Usage, terminal state, and cost facts. Each
transport preserves its protocol-specific context, including DeepSeek reasoning,
Gemini thought signatures, and OpenAI Responses reasoning items. One generic pruning
rule must not discard them.

Each Run pins its model-call and tool-call limits. On a resumed Run, the Worker
subtracts durable prior usage before re-entering the model loop. The last permitted
model call is reserved for a Tool-free user response: it states what completed and,
when work remains, what is incomplete and the next concrete step. The runtime does
not silently extend the pinned limits or report an empty final step as success.

## Tools and approval

ToolView is derived for every model step from current permissions, published
Workflows, Canvas state, and model capabilities. Skill discovery never expands that
authority. A tool schema contains only business input a user may provide, never
`workspaceId`, `subjectId`, credentials, internal model IDs, or charge limits.

- `none`: can execute immediately, with authorization still rechecked at invocation.
- `before_call`: waits for user confirmation before a side-effecting command.
- `before_commit`: may generate a preview, but final commit requires confirmation.

Approving a tool is not permanent authority. A later change to permission, budget,
object version, or execution fence fails closed and returns a recoverable result.

One Workspace setting controls whether ordinary Agent production actions require an
extra confirmation and defaults to streamlined execution. Deletion, publication,
permission, credential, and uncertain-effect actions always require confirmation.

Platform Built-in Tools are code-owned dialogue capabilities and are not part of a
Workspace Tool Family. Their registry revision is included in the Run ToolView digest,
and their model-facing names are reserved. `ask_question` creates an
`AgentInteraction`, moves the Run to `waiting_for_user`, and releases the Worker
lease. Submit or skip records the answer as the original Tool result and requeues the
same Run from a bounded continuation checkpoint; after skip, that Run continues
without offering another question. Cancel ends the Run. This is distinct from
approving an already prepared business action.

## Dynamic Skills

An Agent Revision binds stable Skill identities to improve default discovery. Binding
is not authorization and does not prevent the Agent from searching other accessible
published Skills. A user can also select a Skill explicitly for one Run without
modifying the Agent.

For every Run, Kanvas resolves an immutable Run Skill View from the current Agent
Revision, Thread activations, explicit selection, Workspace visibility, authorization,
runtime status, and content bounds. The Run pins exact Skill Revisions. A later Run
may resolve a newer published Revision of the same stable Skill identity.

Mastra consumes this view through an adapter and provides progressive `skill_search`,
`skill`, and `skill_read` behavior. Kanvas continues to own Skill identity, Draft,
publication, resources, visibility, status, and reauthorization. Skill text is
subordinate Workspace data and cannot change permission, budget, approval, egress,
ToolView, or execution policy. Uploaded scripts are not published, read, or executed.

Reading a Skill loads Markdown SOP guidance into model context. It does not start an
execution state machine and does not prove that the final answer causally applied every
instruction. Only an explicit Workflow tool call creates a Workflow Run with nodes,
progress, results, and recovery facts. A Skill may teach the Agent when and how to call
that Workflow, but the two remain independent objects.

Skill Presentation contains discovery-only title, summary, cover, category, tags,
author, example requests, and example results. It does not enter the Skill Revision
runtime digest.

## State and recovery

Durable Run states are `queued`, `running`, `waiting_for_user`, `waiting_approval`,
`succeeded`, `failed`, and `cancelled`. Web may use stream events for low-latency
feedback, but final state is the MySQL fact returned by Server. Bounded polling while
active is only a fallback for a broken stream. Skill and Brand availability are
rechecked before their content or actions are used; a state or permission race becomes
an actionable visible failure, not a silent fallback.

A recoverable failure tells the user what to do next, such as reauthorize, adjust
input, select another available model, or retry. Unknown provider side effects,
uncertain cost, and version conflicts cannot appear as ordinary automatically
retryable failures.

## Pending conversation messages

The Web client can retain pending messages while an Agent reply is active. Pending
messages are not conversation messages or Runs until Server accepts them. Each item
keeps its text, uploaded attachment references, resource context, and a stable
idempotency key. Storage is local to the browser and scoped to the signed-in Principal,
Workspace, and conversation; it is not a cross-device or closed-browser delivery
service.

Delivery is serial and follows normal reply completion. Stopping, cancellation,
failure, pending approval or questions, and branch changes pause delivery until the
user resumes it. Background production Tasks alone do not block another message.
Uncertain delivery retains the original request and idempotency key for recovery;
it must not silently become an edited or duplicated request. Server permission and
active-Run checks remain authoritative for every submission.

Editing a pending message takes it out of the queue and restores its complete
content and context to Composer. There is no inline queue editor. Taking a message
back must be serialized against delivery; sending or uncertain items cannot be
taken back. An existing Composer draft must not be silently overwritten.

Capability names in the conversation are presentation data. Current authorized
catalog names and the selected UI language may update their display, while original
action receipts, pinned contracts, and execution facts remain immutable. When the
capability is no longer available to the viewer, the recorded title remains a
historical fallback.

## Code locations

- `packages/application/src/modules/agent/`: business types, state transitions, and
  surface context.
- `packages/agent-runtime/`: Mastra adapter, dynamic ToolView, and governed model port.
- `packages/database/src/runtime/agent-*.ts`: Agent persistence and dispatch.
- `apps/worker/src/agent/`: Run processor, model transport, and tool executors.
- `apps/server/src/agent/`: Workspace Agent application service.

See [ADR-0030](decisions/0030-governed-mastra-agent-runtime.md) for the durable
decision.
