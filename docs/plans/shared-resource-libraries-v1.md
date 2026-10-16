# Shared Resource Libraries V1

Status: Implemented and locally verified; not committed, pushed, or deployed.
Decision: [ADR-0040](../decisions/0040-shared-resource-libraries.md).

## Outcome and scope

A designer maintains one product library containing product images, short factual
text, and purpose notes. A design Agent and a copywriting Agent use that same
library. The design Agent also uses an independently selected Brand and Skill.
New work can use updated references while an interrupted Run keeps its original
content identities. A library binding never grants authority.

First release includes PNG, JPEG, WebP, and bounded UTF-8 TXT/Markdown; direct
uploads and eligible existing Workspace Assets; library CRUD with archival rather
than destructive deletion; entry add/replace/remove; name and purpose search;
Agent bindings and explicit per-message selection; text reading, visual model
input, and exact Artifact tool inputs; durable usage and revision records.

Excluded: RAG, PDF/Office parsing, OCR, external synchronization, rich document
editing, folder hierarchies, public or cross-Workspace sharing, per-entry ACLs,
automatic conversation promotion, Agent-authored library mutations, migration of
Brand/Skill resources, and an Agent-local file repository.

## Ownership

| Owner                   | Responsibility                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| Agent                   | Identity, instructions, governed abilities, preferred library discovery        |
| Brand                   | Structured visual and expression guidance, versioned creative assets           |
| Skill                   | Reusable method and resources that belong to that method                       |
| Resource Library        | Topic, entry purpose, membership, revisions, maintenance                       |
| Asset                   | Independently reusable logical content and explicitly adopted current Artifact |
| Artifact / StoredObject | Immutable content, provenance, availability / physical bytes                   |
| Message                 | Explicit task input; private attachments remain private                        |

A Library Entry owns a stable entry identity, display name, purpose, ordering,
exact Artifact reference, and optional source Asset identity. Referencing an
Asset pins its current Artifact at selection time. Later Asset replacement only
offers an explicit update; it cannot rewrite a library revision.

Direct library uploads produce governed Artifacts and a library-owned sharing
reference. They must not become broadly readable through a new global rule that
all unadopted Artifacts are shared. Preview, download, model reads, tool inputs,
and retention all resolve the same authorized library owner chain.

## Lifecycle and version rules

| Action                              | New work                                  | Existing pinned Run                              |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Save metadata or entry changes      | Uses new immutable revision when selected | Keeps pinned revision                            |
| Replace an entry's file             | Uses replacement after save               | Keeps original Artifact                          |
| Remove entry                        | Entry absent from subsequent revisions    | Historical reference remains                     |
| Unbind Agent                        | Removes preferred discovery               | Does not revoke content or rewrite Run           |
| Archive library                     | Excluded from new selection               | May resume pinned reads if otherwise authorized  |
| Revoke permission / disable content | Cannot read                               | Cannot read; version pinning grants no exemption |

Saving uses an expected version and an idempotent mutation identity where needed;
concurrent edits must not overwrite one another. Identical replay must not create
duplicate revisions. Upload verification completes before the mutation commits;
failed attachments cannot appear as available entries. Failed saves retain user
input and provide a reload/retry path.

At Run creation, explicitly selected libraries resolve to exact revisions.
Libraries discovered later pin their current revision atomically on first
selection for that Run. Repeated reads and resumed work reuse that selection.
The record distinguishes candidate metadata, text read, image delivered to a
vision model, and Artifact passed to an execution tool. A read record is not a
claim that a model causally followed all content.

## Authority and content handling

All libraries are shared within one Workspace in V1. Separate read and management
checks use the existing membership model; Agent management does not imply library
management. Agent bindings and user-supplied IDs are never authorization evidence.
Asset selection requires source access and eligibility for shared reuse. Private
conversation imports are excluded from V1 rather than silently promoted.

Only a source-derived media allowlist is accepted. Images use existing byte and
decoder verification. Text requires bounded bytes, strict UTF-8 validation, and
safe rendering; Markdown cannot execute HTML, scripts, or fetch remote links.
Oversized content is rejected or visibly bounded, never silently presented as
complete. Unsupported model vision produces an actionable failure or an explicit
alternate authorized operation, not a fabricated image-understanding claim.

Prompt content is subordinate reference data. It cannot extend ToolView, budget,
egress, approval, or Workspace permissions. Original bytes are reused through
governed Artifact access; no permanent public URLs or new raw-storage bypasses.

## Implementation sequence

- [x] Recheck existing storage, Agent binding, and Brand contracts.
- [x] Record the accepted ownership decision and this delivery plan.
- [x] Implement the Resource Library application module, authorization, immutable
      revisions, relational ownership, migration, and transactional persistence.
- [x] Extend governed upload/read/preview/retention paths for library-owned image
      and text Artifacts; preserve conversation privacy and asset adoption rules.
- [x] Add contracts, transport, and the independent library list/detail/editor UI.
- [x] Add Agent revision bindings and explicit composer selection without changing
      the existing meaning of Brand, Skill, or Workflow bindings.
- [x] Pin library revisions in Runs and connect bounded text/vision/tool consumption
      with durable usage evidence and resume behavior.
- [x] Complete focused tests and authenticated browser acceptance, recording actual
      evidence separately from static or mocked checks.

Follow existing application/database/server module seams. The Resource Library
module should own reference resolution, revision selection, and eligibility so
Agent, preview, and tool callers do not independently reproduce those rules.
Do not introduce a universal resource framework or migrate mature Brand/Skill
modules merely to make the first library implementation possible.

## Acceptance

1. Create a product library with a real image, parameter text, and purpose notes;
   save and refresh to prove persistence and safe content previews.
2. Bind two Agents and verify both discover and actually consume the same library.
3. Use an explicitly selected Brand, a Skill, and the product library for one design
   task; verify the actual image/model/tool input and resulting Artifact provenance.
4. Replace content; prove new Runs see the new revision while a resumed old Run
   uses the original one. Cover concurrent save and mutation replay.
5. Prove cross-Workspace denial, private attachment rejection, revoked access,
   archived library selection, disabled/missing content, and unsupported media.
6. Remove entries and unbind Agents without deleting shared Assets or historical
   content references. Verify retention accounting before enabling cleanup.

Live service, browser, and paid-provider evidence must be labeled independently.
Do not claim E2E completion from schema, unit tests, or mocked model output alone.
No commit, push, deployment, or paid-provider operation is implied by this plan.

### Current acceptance audit

| Requirement                                   | Evidence and remaining work                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Management and previews                    | Live authenticated create/upload/Asset selection/save/reload/preview/archive/restore evidence recorded below.                                                                                                                                                                                                                                                    |
| 2. Shared use by two Agents                   | Two successful real model Runs reference the same revision, entry and Artifact; one explicit selection and one bound-library discovery.                                                                                                                                                                                                                          |
| 3. Brand + Skill + library in one design task | Verified by live combined Run `[redacted-resource-id]`: explicit Skill use, published Brand revision, library revision 6, and a branded Canvas retaining the original library Artifact. The separately authorized additional task is complete.                                                                                                                   |
| 4. Replacement and version isolation          | Real MySQL fixture replaces the Artifact, StoredObject and digest; old Run repeated reads retain old identities and new Run reads new identities. Concurrent saves and replay covered. An actual waiting-for-user/resolution/new-Worker-claim sequence preserves the old pin after a library edit. Browser history stays at revision 3 after library revision 6. |
| 5. Authorization and invalid content          | Library/store/upload/runtime tests cover cross-Workspace denial, ownership, archived binding/selection, revocation, quarantine, media/UTF-8 bounds and no-vision failure. Consumer tests cover membership and service-token revalidation. Final scoped change review completed with no unresolved findings.                                                      |
| 6. Removal, unbinding and retention           | Real MySQL unbinding preserves the second Agent and old binding. Live removal of a source-Asset entry preserves the active Asset, available Artifact, active StoredObject and historical revision. Committed content is excluded from existing upload-session cleanup; no new deletion cleanup is enabled.                                                       |

## Starting evidence

On 2026-10-13, the workspace had a pre-existing modification to
`packages/agent-runtime/package.json`; preserve it independently. Existing Agent
bindings reference stable Skill/Brand/Workflow identities. Existing composer
Artifacts are private until explicit adoption. These are compatibility constraints,
not missing features to remove for easier implementation.

## Progress evidence — 2026-10-13

The first implementation slice adds a Resource Library application vocabulary and
normalization, separate `library.read` / `library.manage` permissions, SQL migration
0019 and matching Drizzle tables, and a transactional repository. Editors can
manage libraries; ordinary Workspace content roles can read them. Service grants
may explicitly include read access, never management. Runtime reference consumers
still require their own integration before this is a delivered product feature.

The repository saves exact Artifact references, verifies source Asset or
library-upload ownership, checks media eligibility, creates immutable revisions,
records audit events, and uses expected versions plus request identities. Library
revision numbers can have gaps after lifecycle changes; the optimistic library
version is the authoritative edit fence. Direct-upload ownership records are not
yet produced by a user-facing upload path.

Verified against a disposable local MySQL database: all migrations applied;
concurrent saves accept one winner and reject the stale writer; exact request
replay returns the original revision; cross-Workspace reads fail; old revisions
survive saves and archival; archived edits fail; revoked membership prevents
historical reads; an unavailable reference rolls back the entire create. The
first run exposed a mysql2 prepared LIMIT parameter issue, corrected by binding
the already-validated integer limit as a string. This is persistence evidence,
not image/text byte consumption, Agent runtime, browser, or provider E2E evidence.

Application and database builds, focused authorization/document tests, text-byte
validation tests, migration inventory checks, and scoped lint passed. Remaining
work includes actual upload validation/commit, authorized resource reads and
retention integration, transport/UI, Agent selections/pins/tools/usage, and the
full two-Agent acceptance scenario.

### Governed file commit and text verifier

Library uploads now have an optional trusted owner context in the existing content
commit transaction. The transaction rechecks library management and active state,
rejects simultaneous Asset adoption or recovered-output promotion, validates media
eligibility, and writes the library upload reference atomically with the Artifact.
Replay verifies the original owner chain as well as content facts, so generic
import and library import cannot silently relabel one another.

Artifact download authorization and revalidation check library read permission for
library-owned uploads. Other runtime consumers still need their library-specific
integration; these changes do not yet expose a production library upload endpoint.
The existing upload cleanup selects only noncommitted sessions; committed library
uploads are excluded, and revision entries retain exact foreign-key references.
No new destructive cleanup path has been enabled.

A strict UTF-8 text verifier now plugs into the existing seal/verify upload
coordinator. It verifies the original byte digest across transport chunks and
rejects unsupported declarations, invalid UTF-8, binary controls, empty content,
and oversized text. Image verification continues through the existing image path.
The current-user permission contract and generated API now include library read
and management permissions; the server and database typechecks pass.

Disposable-MySQL evidence covers atomic library upload ownership, request replay,
relabeling rejection, no implicit Asset creation, historical entry retention after
removal, and download rejection after authority revocation. The original content
transfer integration suite also passed (three tests), separately from four text
byte/verifier tests. Upload-store verification records in the database fixture are
seeded; this is not yet a real HTTP file upload, rendered preview, or model-input
acceptance result.

### HTTP management and upload interface

The server now registers Workspace-scoped list, current detail, save, lifecycle,
and binary file-upload routes with the existing authorization guard and generated
contracts. Each detail response resolves its summary's exact revision rather than
reading a later mutable current pointer. Listing is bounded with a continuation
cursor. Save uses the caller's expected version and request key.

Uploads require a bounded request key, declared supported media, byte count and
SHA-256. Allocation identity includes Workspace, Principal, library and request
key; payload identity includes filename and media facts. Library management and
active state are checked before storage work and again in the commit transaction.
Text uses strict text verification; images use the existing image coordinator.
A committed retry skips body ingestion and rechecks the original commit facts.
The caller cannot supply a storage key, physical object identity or implicit Asset
adoption request.

Contract tests and four upload-orchestration tests pass, as does the server module
startup test. These tests use mocked storage/authorization dependencies and do not
replace the pending real authenticated HTTP and browser upload acceptance. Server
typecheck passes. The independent library UI, source-Asset selection, user-facing
preview, and Agent runtime integration are still pending.

### Library UI and authenticated local acceptance

The independent list and detail routes now expose creation, bounded search and
pagination, file upload/replacement/removal, purpose notes, existing image Asset
selection, save, archive/restore, and on-demand text/image previews. Chinese and
English labels are present. Existing unsaved-change protection covers navigation
and unload; failed mutations preserve editor inputs and identical retries retain
request keys. Text is rendered as inert text, without Markdown HTML execution.

Real Chrome-extension acceptance on the local signed-in administrator session:
created library `[redacted-resource-id]` in the development Workspace; uploaded
synthetic `product-a.md` and `product-a.png`; saved and reloaded; verified exact
Chinese text and PNG preview; selected existing `cover-acceptance-0924.jpg` Asset
through its picker and saved its reference; archived into read-only state and
restored editable state, then reloaded successfully. Acceptance screenshots are
local artifacts at `.tmp/library-acceptance/text-preview.jpg` and
`.tmp/library-acceptance/image-preview.jpg`. The first browser read exposed missing
Workspace headers on the new GET transport, corrected before acceptance.

Development-only migration 0019 was applied after live status confirmed it was
the sole pending migration. Existing Server/Worker processes on 3000/3001 were
preserved. The acceptance Web process runs on 5173 with its API proxy targeting a
separate newly built Server on 3100. At this checkpoint, command session handles
are Web 81323 and Server 1264; recheck liveness before reuse. The browser handoff
tab is 44507755 in the discovered Chrome extension session.

Web typecheck, scoped lint, locale-key/navigation tests and upload preflight tests
are checked separately from this live acceptance. Agent bindings, per-message
selection, revision pinning, runtime reads and tool/model-use evidence remain
unfinished; no two-Agent or paid-provider completion is claimed.

### Agent configuration bindings

Migration 0020 adds a Workspace-scoped Agent Revision to Resource Library binding.
Agent create/update contracts accept at most eight unique library identities;
publishing rechecks library read permission and active same-Workspace ownership.
Agent detail reads expose the linked metadata. Old update clients that omit the
new field preserve existing bindings; an explicit empty list removes them.

The Agent editor now provides a searchable library selector, preserves selected
labels across searches, and reads its saved associations back. Agent detail links
are available with library read access. These are discovery bindings only; no
library content is automatically injected and no authority is granted.

Disposable MySQL tests published two separate Agent identities against one shared
library and verified both read the same association. Archiving the library made a
subsequent publication fail atomically without changing the prior Agent revision.
The complete existing Agent foundation integration file passed (11 tests), along
with Agent service regression tests including omitted-field preservation.
Database, Server, and Web typechecks passed. The generated API was refreshed.

Development migration 0020 was applied after confirming it was the sole pending
migration. The task-owned Server 3100 was rebuilt and restarted; original 3000/3001
processes remain untouched. The restarted command session is 82199. Its initial
storage compatibility probe encountered a connection reset and remains subject to
live readiness verification. Run revision pinning, explicit message selections,
actual content reads, model/tool input and usage records are still pending.

The failed Server 3100 process exited, then one unchanged-configuration retry
succeeded (session 52942). Authenticated Chrome acceptance created private test
Agent `[redacted-resource-id]`, selected product library
`[redacted-resource-id]`, saved, and reloaded its detail page. The saved library
link remained visible after reload. Screenshot:
`.tmp/library-acceptance/agent-library-binding.jpg`. This is configuration
persistence evidence; model consumption has not been exercised.

### Run library pins and use facts

Migration 0021 introduces immutable Run-to-library revision pins and library-use
facts. The message contract now accepts explicit library IDs, projects them into
Run context, and pins their revisions inside the existing Run-creation transaction.
Regenerated Runs resolve their own revisions; idempotent replay returns the original
Run and pins. Runtime discovery pins a library once under the Run lock, bounded to
eight selections. Existing pins remain readable after ordinary library archival;
new selection requires an active library.

The Agent Library repository requires an active, unexpired Run owned by the caller
and current library read authority. Reference lookup verifies exact entry/Artifact
identity, current availability, stored byte digest, storage identity, and source
Asset or direct-library-upload ownership. Source Asset reads recheck asset read
permission. Content classification accompanies the authorized descriptor. Catalog
metadata for selected libraries uses the pinned revision instead of current edits.

Use facts distinguish text reads, image views and tool inputs, protect request
identity against replay with another source, and revalidate content before recording.
They are not emitted merely by selection; Worker consumers still need to call them
after the corresponding successful byte/model/tool operation.

Disposable MySQL tests cover explicit pinning in Run creation, identical request
replay, old/new Run isolation after library edits, reads after archival, rejection
after content quarantine or Run cancellation, and idempotent use records. Existing
Agent foundation/runtime tests pass. The cancellation fixture was corrected to set
its terminal timestamp in accordance with the existing database invariant.
Migration 0021 has not yet been applied to the development database. Composer
selection UI, Worker tools, actual byte/model consumption, and visible usage records
are the next integration work; this checkpoint is not Agent E2E completion.

### Worker tools and task selection

The query Tool Family now includes `library.search`, `library.inspect`, and
`library.read` for new Runs with library access. A server-owned `libraryTools`
context marker keeps old Runs on their original ToolView. Server admission and
Worker execution use the same projection and digest material. Search prioritizes
explicit selections and Agent bindings; inspect pins a directory; read resolves
an exact entry and bounded original bytes, verifying storage identity, size and
SHA-256 before returning content. Text uses strict UTF-8 decoding. Image output
uses the existing model tool-content image format; receipt metadata omits image
bytes. Vision capability is checked before image I/O. Recording the read performs
a second authorization/availability check after storage I/O.

Capability creation checks library-derived Artifact inputs and records `tool_input`
in the same transaction as the accepted Capability Run. This records an accepted
tool input, not provider completion. Inputs must belong to the action's owned Run
and pinned library revision. Existing nonlibrary capability behavior is retained.
Workflow-specific input recording and final consumer/recovery audits remain to be
completed before claiming the entire tool-consumption requirement.

Composer reference selection includes libraries, bounded to eight and searchable
by the server. Submitted IDs enter the Run creation contract; draft persistence,
queued request snapshots and taking a queued message back preserve library
selections. This does not automatically attach every Agent-bound library.

Worker tests cover complete text, real byte-to-image model projection, digest
failure, post-I/O revocation, and missing vision support, alongside the existing
Agent processor tests (23 passed). Composer/queue/locale tests passed (24). These
are deterministic tests with controlled storage/model dependencies, not a real
provider response. The database foundation suite tests accepted tool-input source
records. The repository's pnpm build script was used to synchronize new files into
injected workspace dependencies; direct TypeScript invocation alone did not copy
new module files into the injected Agent runtime package.

Remaining: live task-selector readback; two-Agent Worker/provider use; usage-source
presentation; Workflow and Canvas input paths; full recovery, permissions and
consumer reauthorization audit. Local Server/Worker processes must be upgraded and
migration 0021 applied before this new Run path is exercised in the live UI.

### Historical source presentation

Assistant messages now expose distinct recorded library uses with the pinned
library name, entry name, revision number, and read/view/tool-input kind. The
history query checks current `agent.read` and `library.read`, thread ownership,
Workspace, and visible Run IDs. It returns source labels, not file bytes. Selection
and binding alone produce no usage evidence. Cancellation or file quarantine does
not erase historic evidence or authorize another read of the file.

Disposable MySQL acceptance covers old revision labels after an update, an empty
result for an unused Run, rejection for a missing conversation, and history after
cancellation/quarantine. It caught a reserved SQL alias, which was corrected. The
foundation suite passes (12 tests); existing server projection tests pass (27),
and the thread UI suite passes (32), including inert rendering of source labels.
Server, web, and database TypeScript checks and scoped lint pass. Contracts and
web API types were regenerated. Live browser verification of these source labels
and the remaining Canvas/Workflow/dual-Agent consumption work are still pending.

### Canvas library image input

New library-enabled Runs can place an exact pinned library image with
`canvas.add-result-image`, using a library/entry pair and matching Artifact ID.
The Worker checks the pinned reference and image media type; the database checks
the active action, Run, current authority and exact library entry again within the
Canvas update transaction. Canvas update, retained Artifact references, revision,
audit and library `tool_input` evidence commit together. A supplied library input
must actually appear in the Canvas document. Explicit source selection records
only that entry even when the same Artifact occurs in multiple pinned libraries.

The Canvas projection retains schema version 2 for old Runs; schema version 3 is
conditional on the same library-tools marker in Server admission and Worker
execution. Partial or mixed sources are rejected. Receipt-based recovery remains
authoritative: a different action with identical Canvas content cannot take the
generic content-only replay shortcut and claim an unrecorded library use.

Worker Canvas/processor tests pass (19), projection tests pass (1), Canvas store
regressions pass (14), and server Agent tests pass (27). Disposable foundation
tests pass (12), including rejection of nonimage library placement and rollback
of Canvas version and retained references, plus rejection after Run cancellation
with the Canvas version unchanged. TypeScript checks pass for database,
server and worker; scoped lint passes. Successful live image placement, cancelled
Run recovery, Workflow input provenance, asynchronous consumer reauthorization,
and the dual-Agent/provider acceptance remain completion gates.

### Workflow input provenance

The confirmed Agent Workflow command now carries trusted invocation authority and
action identity through the application boundary into Workflow persistence. It
rejects a Workspace/principal mismatch before replay or creation. The repository
records pinned library tool inputs in the same transaction as the Workflow Run;
node creation and outbox publication remain in that transaction. The provenance
is internal command metadata and is not a new client-controlled API field.

Disposable MySQL tests verify successful Workflow input evidence and rollback of
the Workflow row after the originating Agent Run is cancelled. Source history
deduplicates the same entry/use kind without dropping the distinct internal
consumer records. The foundation suite passes (12), application Workflow tests
pass (9), and server Agent tests pass (27). Application/database/server TypeScript
and scoped lint checks pass.

The asynchronous consumption audit found an unresolved authorization seam:
`WorkerInputArtifactResolver.bind` currently carries Workspace/input/signal, and
`StorageUploadStore.readAuthorizedCommittedObject` checks object availability and
storage identity without the originating caller's current permissions. Both
local adapter execution and provider submission bind this resolver. Creation-time
permission checks therefore do not prove post-creation revocation behavior.
Before live acceptance, persist or resolve trustworthy consumer authorization,
carry consumer identity into these reads, and revalidate before byte access. Do
not infer caller authority from Workspace membership alone or bypass service-token
revocation. This remains required work, along with the live dual-Agent and Canvas
consumption/recovery gates.

### Asynchronous consumer authorization

Migration 0022 adds immutable per-consumer/per-Artifact authorization facts, saved
alongside accepted Capability/Workflow library input. The snapshot contains the
trusted authority identifiers and its digest, plus whether Asset read permission
is also required. It contains neither file bytes nor a raw service token. Canvas
mutations remain synchronous and do not create an asynchronous consumer record.

The local adapter and provider runner pass their actual Capability Run identity
to the Worker input resolver. The shared database check resolves direct Capability
or parent Workflow authorization, verifies consumer ownership, active lifecycle,
deadline, cancellation and Artifact availability, then calls the existing current
authority revalidator for `library.read` and, where needed, `asset.read`. This
retains service-token/grant expiry and revocation checks instead of substituting
the creator's Workspace membership. A library upload without retained consumer
authority fails closed; unrelated existing Artifact input behavior is unchanged.

The resolver rechecks before metadata access, delayed storage open and provider
URL creation. Missing authorization configuration for a consumer also fails
closed. Previously issued signed URLs remain subject to their existing expiry;
this change does not claim instantaneous revocation of an already issued URL.

Disposable MySQL tests verify successful accepted consumption, rejection of a
different consumer, expiry/cancellation, and membership revocation (Capability
consumer suite: 1 scenario; Agent foundation suite: 12 tests). Worker resolver,
local execution and provider regressions pass (54). Authorization tests pass
(12), including saved service-scope revalidation after token expiry/revocation;
migration inventory passes (3). Database/Worker type checks and scoped lint pass.
The local deterministic canary's controlled fixture now explicitly supplies its
authorization callback. Its success is not live provider evidence.

Migrations 0021/0022 are still pending on the development database. Next steps are
to update the local acceptance runtime without mixed old/new Workers, exercise
two Agents and actual Canvas/Workflow consumption, and inspect rendered sources
and recovery. The full goal remains incomplete until those gates are proven.

### Live dual-Agent and Canvas acceptance

The development database was read back as idle before applying 0021/0022. Its
migration check now reports current. Original Server 3000 remains running. The
idle old Worker was replaced with the newly built Worker on 3001; the task-owned
acceptance Server remains on 3100 and Web 5173 proxies to it. Current command
sessions are Worker 53273 and Server 6615 (recheck liveness before reuse).

The browser approval review initially rejected sending a real Agent request.
No workaround was used. The user then explicitly authorized up to three Agent
acceptance tasks through the configured TokenHub endpoint
`https://us-api.tokenhub.com`, model `gemini-3.7-flash`, using only synthetic
`product-a.md`, `product-a.png`, and test instructions; no image generation or
recharge, with the existing USD 1 maximum per model call. That authorization's
three-task allowance has now been consumed. Do not start further external model
acceptance calls under it.

The first Run failed before external model preparation because the new Canvas
tool description exceeded the runtime's 512-character limit. A regression test
using actual `createKanvasMastraTools` reproduced the precise error. The new
library-enabled description was shortened while preserving the old projection;
the test and all 91 Agent runtime tests pass. Server and Worker were rebuilt and
restarted together. The failed Run is retained as failure evidence, not claimed
as successful recovery or a provider call.

Two subsequent Runs succeeded through the real configured model:

- Design Agent `[redacted-resource-id]`, Run
  `[redacted-resource-id]`, explicitly selected the library, read Markdown and
  PNG, correctly reported KA-100, 20 x 10 x 5 cm, aluminum, light/durable and a
  blue rectangle, then placed the original PNG into a real editable Canvas.
- Copy Agent `[redacted-resource-id]`, Run
  `[redacted-resource-id]`, discovered the library from its saved Agent binding
  without a per-message library selection and read the same Markdown for a short
  factual product description.

Database evidence confirms both text uses share revision
`[redacted-resource-id]` (revision 3), entry
`[redacted-resource-id]`, and Artifact
`[redacted-resource-id]`. Canvas `[redacted-resource-id]` version 2 is
400 x 300, with one independent image node referencing original Artifact
`[redacted-resource-id]`, at (40,40), 240 x 160, `contain`. The browser
rendered that blue rectangle and showed revision-3 text/image/tool-input source
records. No new image-generation task was requested.

Local evidence: `.tmp/library-acceptance/runtime-evidence.json`,
`agent-canvas-result.jpg`, `agent-read-sources.jpg`, `second-agent-binding.jpg`,
and `second-agent-result.jpg`. These are ignored acceptance artifacts. The current
Chrome handles are `libraryTab` (design conversation/Canvas) and
`librarySecondTab` (copy conversation); preserve only needed handoff tabs.
Architecture checks and maintained documentation links pass. Remaining closure
includes the final requirement audit, Workflow asynchronous-consumer coverage,
and any identified recovery/permission gaps; do not infer full completion from
the two successful live Runs alone.

### Final lifecycle and Workflow checks

The real Workflow engine suite now starts a queued Workflow and creates its
node Capability, then resolves library authorization exclusively from the parent
Workflow's retained authority. It proves allowed access, no synthetic direct
Capability authority row, rejection of another consumer, and rejection after
membership revocation (10 tests in the suite pass). No provider network call is
made by this fixture.

Agent foundation tests now replace the file reference with a different Artifact,
StoredObject and SHA-256; old Run reads retain the original and the subsequent Run
resolves the replacement. This fixture tests database reference identities; byte
verification and upload lifecycle remain covered by their separate suites. The
same suite proves one Agent can unbind an archived library while the other Agent,
library revision and old profile binding survive (12 tests pass).

Authenticated browser maintenance removed `cover-acceptance-0924.jpg` from the
test library and saved/reloaded it. The current content revision is 6 (archival
and restoration previously advanced the library's optimistic version). Revision
3 still has three entries; revision 6 has two. Source Asset
`[redacted-resource-id]` remains active, its Artifact available and StoredObject
active. Reloading the copy Agent conversation still displays revision-3 usage.
Evidence: `.tmp/library-acceptance/retention-evidence.json`,
`library-after-removal.jpg`, `history-after-library-edit.jpg`.

Broader scoped regression checks pass: four Server suites (35 tests) and 24 Web
suites (167 tests) covering the affected Agent, library and Brand boundaries.
The concrete remaining acceptance gap is item 3 above; do not mark delivery
complete until it and the final change review are satisfied.

### Delivery closure

After the initial three-task authorization was exhausted, the user separately
approved one additional real Agent task through the same TokenHub model and cost
bounds. Synthetic Brand `资料组合验收品牌` and Skill `资料组合验收排版` were created
and published only for this acceptance. The Brand contains visual/expression
rules, and the Skill only a method; product facts remain in the shared library.
The test Brand's Logo is an explicitly imported synthetic blue image Asset, not
an automatic adoption of a library upload. Existing business resources were not
modified and no default-brand setting was changed.

Combined Run `[redacted-resource-id]` in conversation
`[redacted-resource-id]` succeeded. Its authoritative facts show:

- Brand revision `[redacted-resource-id]` was explicitly selected and inspected.
- Only Skill `[redacted-resource-id]` was recorded as used, source `explicit`;
  its instruction digest is pinned in the Run foundation.
- Library revision `[redacted-resource-id]` (revision 6) supplied text, model
  image content and the Canvas image input. The original PNG Artifact
  `[redacted-resource-id]` was reused.
- Canvas `[redacted-resource-id]` version 3 is 640 x 480 and retains the
  selected Brand revision. Its KA-100 title uses Noto Sans SC and `#3048F5`;
  its independent image is at (40,180), 240 x 160, `contain`. The browser rendered
  both correctly. This demonstrates actual resource use, not a claim that every
  style suggestion was causally or exactly followed (the title size is 48).
- All eight governed actions succeeded, ending with `canvas.inspect`.

Evidence is retained in `.tmp/library-acceptance/composition-evidence.json` and
`composition-result.jpg`. The additional call authorization is consumed. No image
model was invoked and no service was purchased or recharged.

Final verification:

- Six MySQL integration suites: 27 tests pass, covering library management,
  ownership, pinning, consumer authorization and real Workflow node dispatch.
- The Agent runtime integration was extended and rerun successfully to verify
  actual user-question suspension, library modification, response, and claim by
  another Worker without changing the original library pin.
- Contracts: 163 tests; Application: 153; Storage: 92 pass. One opt-in standalone
  S3 adapter integration test is skipped because its test configuration is absent;
  the configured live upload/read path was exercised independently in browser and
  real Agent acceptance.
- Agent runtime: 91; affected Web: 167; affected Server: 35; Worker input/dispatch/
  provider: 54 tests pass. Authorization and migration inventory checks also pass.
- Affected source lint, formatting, Web/Server/Worker/Database TypeScript checks,
  architecture boundaries and maintained documentation links pass.

The final audit above has no outstanding first-release requirement. Delivery is
local only. The pre-existing `packages/agent-runtime/package.json` development
script change remains intact. No commit, push or deployment was performed. Test
resources and named acceptance Canvases remain available for inspection.
