# ADR-0039: Preserve native Agent transcripts and settle Runs after model completion

- Status: Accepted
- Date: 2026-10-12
- Extends: [ADR-0030](0030-governed-mastra-agent-runtime.md) and [ADR-0032](0032-agent-first-dynamic-skills.md)

## Context

Mastra Skill instructions are ordinary tool results, retained through conversation
history. Replaying only user-visible text loses those results, reference images,
and their Artifact identifiers. A separate race lets production confirmation end
an Agent Run while its model is still replying, preventing final message storage.

## Decision

1. MySQL retains each turn's native Mastra messages in
   `agent_message.model_messages`, attached to its assistant branch node. This
   includes the turn's user input, tool calls and results, multimodal content, and
   provider metadata. User attachments are materialized as immutable bytes rather
   than expiring provider-read URLs. Ordinary conversation APIs continue to return display
   projections, not the internal transcript.
2. Restore only the triggering message's ancestry, using Mastra's message converter.
   Deduplicate user inputs by message identity and order restored messages by their
   owning branch timestamps. A stored turn never copies preceding turns.
3. Existing question checkpoints continue to own suspension and resume. Normal
   completion and resumed completion persist through the same final-message path.
   Text streaming updates cannot erase a stored transcript.
4. Observational Memory receives native messages rather than display-only text.
   Its coverage boundary uses the owning branch message timestamps. No separate
   Skill activation state or second framework database is introduced.
5. Production confirmation advances the Action without terminating a live model
   loop. After saving final display and model messages, the Worker settles the Run
   under the conversation mutation lock using current Action facts. Confirmation
   uses the same settlement operation once the Run is waiting for approval.
   Pending Actions keep it waiting; failed proposals fail it; otherwise it succeeds.
6. Worker settlement validates its dispatch lease and requires persisted model
   messages. Confirmation may recover a legacy action-owned running Run only when
   its model dispatch is already completed.
7. Recursive ancestry queries sort lightweight rows; native multimodal payloads
   are fetched by the resolved message IDs afterward to avoid sorting large JSON.

## Consequences

Historical messages without transcripts retain the text fallback; absent tool
results cannot be reconstructed. Native messages are committed on normal completion
or question suspension, not after every model step. This does not promise recovery
of uncommitted model steps after a process crash. Existing ActionReceipts remain
authoritative for idempotency and uncertain external effects.
