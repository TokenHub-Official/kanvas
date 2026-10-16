# ADR-0033: Manage the Workspace default Agent as system infrastructure

- Status: Accepted
- Date: 2026-09-10
- Extends: [ADR-0032](0032-agent-first-dynamic-skills.md)

## Context

Every Agent Thread must belong to one stable Agent, so the default conversational
entry needs a persisted Agent identity and immutable Profile Revisions. Treating that
identity as ordinary Workspace-authored content is nevertheless unsafe: an editor can
change its instructions or visibility, its apparent human owner is only the bootstrap
actor, custom Agent creation inherits mutable default-instance state, and the default
surface binding can drift from the latest edited Profile.

LobeHub demonstrates the useful separation: its visible Inbox assistant has a
reserved built-in identity, a provisioned persistence row, code-owned runtime
behavior, dedicated default routing, and special lifecycle/UI treatment. Kanvas keeps
its stronger immutable Revision and authorization model rather than copying
LobeHub's lazy provisioning or client-owned runtime decisions.

## Decision

1. Each Workspace has exactly one **Built-in Default Agent**, identified by a durable
   system management fact and the system key `workspace-default`. Display name and
   Profile key are not identity classifiers.
2. The Built-in Default Agent remains in the normal Agent/Revision/Thread relation so
   historical Threads, Runs, actions, and audits retain exact references.
3. System code owns its identity, presentation, instructions, Tool Family policy, Run
   limits, first-party bindings, visibility, activation, and lifecycle. Ordinary Agent
   management cannot edit, transfer, hide, archive, delete, disable, or republish it.
4. Workspace model, reasoning, web-search, and ordinary-action confirmation settings
   remain separate configurable facts. Run-specific Skill, Brand, Workflow, and file
   selections remain context, not mutations to the default Agent.
5. The default surface binding selects the current system-published Profile Revision
   for new Threads. Existing Threads retain their pinned Revision. System publication
   updates the Revision and surface binding atomically.
6. Custom Agents are created from the stable code-owned Agent template, not by cloning
   the current persisted default Agent instance.
7. Instance initialization provisions the default Agent transactionally. Explicit
   bootstrap is idempotent and may repair or upgrade it; ordinary message resolution
   does not create data as a side effect.
8. The interface presents the Built-in Default Agent separately from custom Agents,
   labels it as system default, omits a human creator, and exposes only the Workspace
   settings that are actually configurable.

## Consequences

- One system-management policy must be used by bootstrap, publication, Agent Hub,
  default resolution, contracts, and Web presentation; callers must not rediscover
  the rule from `first-party.main-agent`.
- A schema migration backfills the current default definition without changing any
  Agent, Profile, Thread, or Run identity.
- Background model-call purposes such as Thread naming and memory observation remain
  internal execution purposes and do not enter the Agent library.

## Rejected alternatives

- Treat `Kanvas Agent` as an ordinary Agent and add only a badge.
- Infer system ownership from display name or Profile key at every call site.
- Store the default assistant outside the Agent model and lose normal Thread/Run
  identity.
- Lazily recreate the default Agent during ordinary message reads.
- Add a general Workspace instruction override before a concrete default-customization
  journey requires it.
