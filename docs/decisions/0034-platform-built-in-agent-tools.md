# ADR-0034: Separate Platform Built-in Tools from business Tools

- Status: Accepted
- Date: 2026-09-13
- Extends: [ADR-0030](0030-governed-mastra-agent-runtime.md) and [ADR-0032](0032-agent-first-dynamic-skills.md)

## Context

Every Agent needs a small set of interaction capabilities that improve the dialogue
but do not belong to one Workspace, Skill, Workflow, or business domain. Asking the
user a structured question is the first case. Treating it as an ordinary business
Tool would incorrectly create an ActionReceipt and make it configurable through Tool
Families. Treating it as UI-only behavior would prevent the model from deciding when
clarification materially changes the result.

LobeHub demonstrates the useful interaction pattern: a model calls a reserved
user-interaction Tool, the client renders a structured form, the submitted answer is
persisted as that Tool's result, and generation continues from the suspended turn.
Kanvas needs the same product semantics while retaining its database-owned Run,
authorization, budget, and recovery authority.

## Decision

1. **Platform Built-in Tool** is a code-owned Agent runtime concept. Each definition
   has a stable platform key, reserved model-facing name, revision, lifecycle class,
   bounded input and output schemas, description, and usage instructions. Workspace
   configuration cannot add, remove, rename, or shadow it.
2. The built-in registry and its revision are combined with the dynamic business
   ToolView digest when a Run starts. Server and Worker must reproduce the same
   combined digest before execution.
3. Built-ins do not bypass Kanvas authority. A built-in with no business side effect
   does not create an ActionReceipt; a built-in that waits for a person creates a
   durable **Agent Interaction** fact. Business Tools continue through canonical
   validation and ActionReceipts.
4. `ask_question` is the first built-in. It accepts one to three questions, two to
   four stable options per question, optional multi-select, one recommended option,
   and a custom-answer path. The model should use it only when the response materially
   affects the result.
5. Suspending `ask_question` atomically persists its request and a bounded,
   adapter-versioned continuation checkpoint, moves the Run from `running` to
   `waiting_for_user`, and completes the current Worker dispatch lease.
6. `waiting_for_user` is distinct from `waiting_approval`. A question asks for
   information; an approval authorizes an already prepared consequential action.
   Their records, API contracts, interface controls, and recovery behavior remain
   separate.
7. An answer is validated against the original persisted question and resolved with
   optimistic concurrency plus an idempotency key. Submit and skip requeue the same
   Run; cancel ends it. A repeated identical resolution is a replay, while conflicting
   input is rejected.
8. Resume converts the answer into the original `ask_question` Tool result. It does
   not append a synthetic user message or execute the Tool again. A fresh Worker and
   fresh Mastra Agent may resume from the persisted checkpoint; in-process runtime
   state is never required. When the user skips clarification, `ask_question` is no
   longer available for the rest of that Run, so the Agent must proceed with
   reasonable assumptions instead of opening a replacement question.
9. Mastra owns model-loop suspension and message adaptation only. Kanvas MySQL owns
   Interaction lifecycle, continuation durability, Run state, dispatch fencing, and
   audit identity. Mastra Storage is not a second source of truth.
10. The Web interface receives only semantic question, option, answer, lifecycle,
    and version fields. It never receives the continuation checkpoint or internal
    ToolCall relationship. Pending form drafts may be kept in browser-session storage
    as a convenience, but the submitted resolution is server-authoritative.
11. Model-call and Tool-call limits remain cumulative across suspend and resume. New
    model and ActionReceipt identities continue after the highest persisted ordinal;
    a resumed process must not restart counters at one.

## Consequences

- Adding another built-in requires an explicit registry definition, digest revision,
  lifecycle owner, persistence strategy when it waits, semantic API projection, and
  restart-boundary tests. Adding only a model schema is insufficient.
- Agent message rendering can recognize an Interaction without presenting
  `ask_question` as generic Tool activity.
- Deployment must apply the Interaction migration before Workers advertise the new
  built-in digest.
- Existing `waiting_approval` behavior and business Tool execution remain unchanged.

## Rejected alternatives

- Model clarification as plain assistant prose followed by a new user message.
- Reusing ActionReceipt approval records for questions.
- Persisting only a process-local Mastra suspend handle.
- Making Mastra Storage authoritative beside the Kanvas database.
- Allowing a Workspace Tool or Skill to replace a reserved built-in name.
- Replaying the entire Run from the original user prompt after an answer.
