# Workspace brand contract v1

This document records stable objects, versioning, and consumption boundaries for
Workspace brand context. See [STORAGE-AND-UPLOADS.md](STORAGE-AND-UPLOADS.md) for the
Artifact and Asset relationship and
[EXTERNAL-RESOURCE-SOURCES-V1.md](EXTERNAL-RESOURCE-SOURCES-V1.md) for external fonts
and resource adoption.

## Product model

Brand Center lets administrators maintain reusable logos, colors, fonts, text styles,
and concise guidance. Designers insert or apply them in Canvas; inserted content
remains ordinary editable nodes rather than a separate brand-object layer.

A Workspace has at most one default BrandKit. A new Canvas may pin the default Revision
at creation, but it does not follow the newest brand dynamically on every open.

## Durable objects

| Object                           | Responsibility                                                 |
| -------------------------------- | -------------------------------------------------------------- |
| `BrandKit`                       | Workspace identity, name, lifecycle, default, current Revision |
| `BrandKitDraft`                  | Editable working copy with optimistic version                  |
| `BrandKitRevision`               | Immutable published snapshot and content digest                |
| `BrandAssetReference`            | Logo or reference image pinned to an exact Artifact            |
| `CanvasDraft.brandKitRevisionId` | Brand version pinned on creation or explicit adoption          |

BrandKit does not store a second file copy. Logos and reference images point to
existing Workspace Artifacts. Choosing content from an Asset pins its current Artifact
at that moment rather than dynamically following `Asset.currentArtifact`.

Reference images are distinct from Logos. They carry a name and optional usage note,
and communicate visual direction such as composition, lighting, photography, or
material treatment. A published Revision pins each selected image Artifact. When a
published Brand is selected for an Agent Run, a bounded set of these images becomes
trusted visual input alongside the compact Brand Context.

## Draft and publication

Editing changes only BrandKitDraft. Save requires an expected version; a conflict
never becomes last-write-wins. Publication performs one transaction:

1. Re-read the Draft and all references.
2. Validate Artifact, Font Revision, colors, text styles, and Workspace ownership.
3. Generate a canonical document digest.
4. Create an immutable BrandKitRevision.
5. Atomically update BrandKit's current Revision and write Audit.

No content change means no duplicate Revision. Archiving prevents new selection while
historical Canvases retain their pinned Revision.

## Content

### Logos and images

Brand content references an explicit Artifact, purpose, and optional display name.
Publication requires an available Artifact in the same Workspace. Replacing an Asset's
current version does not change an old Brand Revision.

### Colors

A color has a stable key, user-visible name, purpose, and canonical value. A Canvas
command explicitly chooses page background, graphic fill, or text color; selecting a
color never guesses its target.

### Fonts and text styles

A font pins an internal Font Revision. A text style references font, size, weight,
line height, letter spacing, color role, and required alignment rules. An unavailable
font presents fallback and recovery without rewriting the Revision.

### Guidance

Concise guidance stores creator-facing do and avoid rules. It is user content, not a
model system prompt, and cannot change authority, budget, provider, or tool policy.

## Canvas consumption

The Canvas brand panel projects a pinned Revision into actions to:

- insert a logo;
- insert new text using a brand style;
- apply a color to an explicit current selection;
- apply a text style to compatible text nodes;
- inspect guidance and version state.

Each action is a normal Editor command that supports Undo and Redo and saves against
the Canvas Draft version. BrandKit Revision supplies provenance and style but never
owns a Canvas node.

Publishing a new brand version does not bulk-edit existing Canvases. Canvas may show a
nonblocking update state; after the user inspects differences and explicitly adopts
it, the Draft pins the new Revision. Adoption affects later insert and apply actions
without automatically rewriting existing nodes.

## Workflow and Agent

WorkflowRun may pin a BrandKitRevision at creation and project the minimum Brand
Context. Workflow and Provider read only brand fields and Artifact references needed
for the current task and cannot switch versions. An authorized Agent may list, create,
and update Brand Drafts through governed Brand commands. Publishing remains a
reviewable action and produces the same immutable BrandKitRevision as Brand Center.

A model output described as on-brand is a suggestion based on pinned input. Final
Artifact, Canvas application, and human decision remain governed by normal Workflow
and Agent boundaries.

## Authority and failures

Read, edit, publish, set default, and archive are separate permissions. Every write
command revalidates Workspace authority inside its transaction; hiding a client
control is not authorization.

- Unavailable Artifact or Font: block publication and identify the content to repair.
- Draft version conflict: retain local edits and require reloading differences.
- Permission revoked: stop new reads and writes; historical Canvas keeps its Revision.
- Save failure: preserve editing state and allow retry.
- Brand archived: remove it from new selection without breaking historical output.

## Code locations

- `packages/application/src/modules/brand/`: Brand contracts and Application use cases.
- `packages/database/src/runtime/workspace-brand-store.ts`: Draft, Revision, and
  default-brand facts.
- `apps/server/src/http/workspace-brand*.ts`: Workspace Brand HTTP entry points.
- `apps/web/src/routes/brand-page.tsx`: Brand Center.
- `apps/web/src/features/editor/`: Canvas Brand Context consumption.

See [ADR-0028](decisions/0028-versioned-workspace-brand-context.md) for the durable
versioning decision.
