# Agent and Skill Workbench Handoff — 2026-09-05 to 2026-09-07

## Status and evidence boundary

This document is a historical handoff and iteration log. The original 2026-09-05 task
was stopped before completion at the user's request. At that handoff point, only this
note was added; no product code was committed or pushed. Later sections record work
performed on 2026-09-06 and a Skill-domain correction on 2026-09-07. They do not prove
the current UI or repository state.

The original goal was to build a coherent Agent create/detail/edit workbench, a Skill
object and real-file workbench, and consistent Composer references, using observed
LobeHub interaction patterns while retaining Kanvas authorization, publication, and
runtime boundaries. The required proof was a real create, save, reopen, modify, and
return-to-thread journey rather than screenshots or isolated component tests.

## Product judgments captured in the handoff

- Conversation is the primary Agent-first work entry, and prior work should be easy to
  recover.
- Agent, Skill, and resource selection should happen in the conversation context through
  an appropriate picker or drawer, with minimal navigation.
- Resource administration has its own navigation context. It should not inherit the
  conversation history sidebar merely because the Agent profile does.
- Agent and Skill administration needed structural work, not another round of small tab,
  radius, or copy changes.
- The user authorized necessary route, layout, contract, and backend changes and did not
  require another sketch approval before implementation.
- The desired visual language used spacing, typography, background hierarchy, hover,
  selection, and visible keyboard focus instead of pervasive borders or bare blue text
  actions.
- Pages should avoid repeated introductions, hero blocks, duplicate headings, and
  internal implementation explanations.

The priority order was Agent create/detail/edit, Skill create/detail/edit, Composer
references, then smaller refinements. It was explicitly not an invitation for broad
site-wide polish.

## LobeHub observations

The reference surfaces were
[LobeHub Skill settings](https://app.lobehub.com/settings/skill) and an authenticated
LobeHub Agent profile. They were inspected in an existing Chrome session without
changing remote settings or sending a message.

The Agent profile kept identity, model/tools, integrated Skills, and core instructions
inside one Agent context. Skill selection happened in place. Instructions supported a
comfortable rendered view and source editing. Skill management retained object context,
a file tree, and real file content; selecting a code file displayed its source rather
than a download placeholder.

An auxiliary profile-building chat was also observed, but Kanvas was not to display a
nonfunctional imitation without a supporting contract. Remote save and autosave
semantics were not verified. The local LobeHub checkout was useful for reading its
navigation, resource layout, Agent Skill detail/viewer/editor, and Agent/topic drawer
modules, but its revision could differ from the hosted product.

## Intended user journeys

### Agent workbench

Create, detail, and edit were expected to share one object context. A user should be
able to identify the Agent, understand its purpose, read and edit instructions, select
Skills and permitted resources in place, see dirty/saving/success/failure states, and
recover field-level errors. Save should retain context; refresh and reopen should read
back the persisted version. Navigation to and from a conversation should retain the
relevant thread and draft state. No unsupported model control or fake assistant panel
was to be added for visual similarity.

### Skill file workbench

The intended structure was a Skill object collection, the selected Skill's real file
tree, and a content reader/editor. `SKILL.md` was the primary entry. Text and code had
to show real content, images needed a safe preview, and other binaries needed useful
metadata plus download. Add, edit, replace, and remove operations had to preserve every
untouched file and Workflow entrypoint. Draft/publication state, permissions, optimistic
conflicts, and errors had to remain explicit and recoverable. Long names, nested paths,
empty/loading/error states, long content, keyboard use, and narrow layouts were part of
the acceptance boundary.

### Composer references

The Composer needed searchable in-place Skill/resource selection, clear selected state,
image thumbnails, full-name access, and unambiguous removal. Ordinary Skill selection
must not inject its first example prompt; only explicit example selection may do so.
Route-driven selection, repeated selection, removal, and submission payloads had to
remain consistent, and returning to a source thread must not create an unrelated thread
or lose its draft.

## Optional Skill directory guidance

The user accepted an optional file-placement guide based on the then-reviewed
[OpenAI Build skills documentation](https://learn.chatgpt.com/docs/build-skills):

```text
my-skill/
  SKILL.md
  scripts/
  references/
  assets/
  agents/
    openai.yaml
```

`SKILL.md` was required. Other directories were to appear only when content needed
them, without empty placeholders. Product actions could suggest a destination for a
script, reference, asset, or optional UI metadata file while letting the user confirm
the path. A simple instruction-only Skill had to remain valid.

## Shared-worktree boundary at handoff

Commits `a35f87f1` and `0d1ad52b` were prior user-requested, unpushed results. Work after
`a35f87f1` mixed useful verified improvements with an unfinished authoring redesign, so
the handoff required hunk-level review rather than blanket rollback or blanket
retention. The unrelated `apps/worker/:memory:.ses` file was explicitly out of scope.

Useful behavior to preserve included conversation entry/history boundaries; a valid
`createLink(Button)` wrapper without nested links/buttons; real Canvas thumbnails and
search with return-query retention; honest indication that only 50 recent Canvases were
loaded; lazy Markdown rendering; and no prompt injection for ordinary Skill selection.
An earlier eager Markdown import had increased the entry bundle from about 260 KiB to
about 744 KiB and had already been corrected.

At the initial handoff, Agent pages remained separate tabbed/long-form structures,
Skill pages had partial rendered/source editing, and the file tree still treated most
files as download-only. Composer work had switched to Agent Hub Skill data, carried
exact Skill revisions, showed better resource labels and thumbnails, and synchronized
route removal, but the final UI-to-request contract had not been proven end to end.

## Unfinished file API at the initial handoff

The worktree contained an uncommitted proposal for Skill file inputs as either text or
base64, optional file additions/removals on draft mutation, draft resource/package
metadata, and version-pinned published/draft file GET routes. The intended Server logic
validated relative paths, prohibited traversal and protected root metadata, preserved
untouched package resources and entrypoints, reused authorization/storage checks, and
returned private, no-store, nosniff file responses. It required no migration.

This implementation had only passed Contracts build and Server type checking. Generated
OpenAPI/Web types, frontend transport, attachment-preservation tests, permission/version
tests, read/save round trips, running-service proof, package-name preservation, nested
instruction paths, aggregate upload limits, partial-save recovery, and binary/Markdown
security checks remained incomplete. The frontend file tree still could not read the
new data. A single-file limit of roughly 2 MiB, 20 input files, and a 16 MiB route body
limit also needed one coherent user-facing boundary.

## Acceptance checklist retained for later work

The handoff required proof of:

- Agent create, edit, save, refresh/reopen, field error, and return-to-thread behavior.
- Skill creation with only `SKILL.md`, optional guided files, one-file edit/add/remove,
  untouched attachment/entrypoint preservation, conflict recovery, and real content
  reading across text, code, image, and binary files.
- Honest draft/published/read-only/editable states with no implicit publication or fake
  test success.
- Composer selection, inspection, removal, reselection, route synchronization, and exact
  submitted references without automatic example text.
- Usable hierarchy, scrolling, fixed actions, empty/error states, long names, keyboard
  focus, and narrow-screen behavior.
- Regression protection for conversation history, Canvas previews, source return, and
  search state.

No paid generation or local model was required to validate those reference and
persistence contracts. Any model result not actually executed had to remain labeled as
unverified.

## Iteration record — 2026-09-06

The first 2026-09-06 implementation connected a continuous Skill object/file workspace.
It added compact Skill selection, fixed-version file reads, text/code editing, file add,
local file selection, removal, and download. Draft update preserved untouched files,
manifest, and Workflow entrypoints. Tests covered paths, duplicate edits, encoding, and
rejecting stale draft versions before storage access. Save did not publish.

Chrome tested private QA draft `[redacted-resource-id]` by creating and saving
`SKILL.md`, `references/notes.md`, and `scripts/check.py`, editing the script, adding then
removing another reference, choosing a cover, and refreshing. The original user Skill
was not modified. Sixteen Server tests and 14 Web tests, type checking, lint, Server
compilation, contract generation, Web build, and localized-key checks passed. Skill
publication, script/model execution, ordinary-member permissions, image preview E2E,
and more than 100 Skill results were not tested.

The user then rejected duplicate list/detail navigation and asked for a closer real
comparison with LobeHub. A second iteration used one object workspace with independently
scrolling object and file areas, single-file directory collapse, narrow-screen drawers,
dirty-state protection, and fixed-version caching. Seventeen focused Web tests, type
checking, lint, localization checks, and Chrome journeys passed. No Worker, model,
script, or real publication ran.

After an Excalidraw review, a third iteration briefly used an independent Skill list
with a large detail modal and extracted reusable `SkillDetailContent` and
`AgentDetailContent`. It also converted missing stored Skill bodies into an integrity
error with a recovery explanation instead of a generic retry. Nineteen Web and four
Server tests plus relevant checks passed. Chrome later became unavailable, so the
extracted Agent view, create/save branch, and new missing-content message did not receive
final browser proof.

The user then corrected the container choice: reusable content did not imply a modal in
the administration area. The modal state was removed. List, published detail, draft
detail, and edit became independent pages under the global administration navigation;
the reusable detail components remained available for a future conversation preview.
Selected-file and search/scope query state followed navigation, and dirty-state
protection remained.

The restored Chrome session verified list to published detail, return to list, draft
detail, script selection, independent edit, and return to the same file in read mode,
with the global menu always present and no overlay. Three files and 10 focused tests,
type checking, lint, and whitespace checks passed. No full suite or complete build ran,
and no change was committed.

## Skill domain correction — 2026-09-07

The final recorded domain correction removed a platform-wide `resultType` from Skill.
A Skill is an on-demand instruction and resource package, not a declaration that every
use produces image, text, or a mixed result. Expected output belongs to a task or test
case. Candidate testing still pinned a revision and execution subject and required a
successful Run; when a deliverable Artifact existed, the test could validate ownership
without requiring every Skill to produce one. The image-derived one-click entry kept
its source-image check as a specialized operation rather than a universal Skill rule.

## Environment and validation cautions from the handoff

The original environment required Node 22.22.0 from `/opt/homebrew/bin/node`, the
existing Chrome extension session only, no local model, no unsolicited Figma, and no
blind service or Worker startup. Browser/tab IDs and temporary reports were explicitly
treated as ephemeral. Focused tests and earlier browser checks did not establish a
latest full-suite, mobile, ordinary-member-permission, Skill-publication, or model-run
pass. QA objects and real user drafts were identified to prevent accidental mutation;
their IDs in this historical note may no longer exist and must not be treated as current
fixtures.
