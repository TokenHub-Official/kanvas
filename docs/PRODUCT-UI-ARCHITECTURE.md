# Product UI architecture and user journeys

This document covers public entry points, Studio, and Workspace administration in
`apps/web`. [DESIGN.md](../DESIGN.md) defines visual language,
[PRODUCT-UI-EXPERIENCE-NORTH-STAR.md](PRODUCT-UI-EXPERIENCE-NORTH-STAR.md) defines
experience principles, and [CONTRIBUTING.md](../CONTRIBUTING.md) defines review and
verification.

## Responsibility

This document records long-lived interface objects, page responsibilities, entry
conditions, successful destinations, and recovery boundaries. Router source is the
authority for registered paths; this document explains product ownership rather than
copying a refactor plan or verification log.

Contracts and domain documents remain authoritative for objects, permissions, and
state transitions. A page does not turn an internal model, compatibility field,
provider mechanism, or database requirement into a user concept.

## Primary information architecture

```text
Public entry
├── Login
├── Invitation
├── Instance setup
└── Workspace gateway and public recovery states

Studio
├── Home
├── Start creating
├── Canvas
├── Assets
├── Brand
└── Production
    ├── Workflow definitions and authoring
    ├── Production templates
    ├── My runs
    └── Capabilities

Workspace administration
├── Settings index
├── General
├── People and invitations
├── Usage and quotas
├── Providers
├── Capabilities and run methods
└── Run diagnostics
```

Studio supports starting, continuing, inspecting, and reusing creative work. Workspace
administration is a secondary entry and does not compete with everyday creation
navigation. Canvas and Workflow are peers: Canvas is a direct editing space, while
Workflow is a publishable reusable execution process. They interoperate only through
explicit input, Artifact, Asset, and Brand Revision facts.

Project and standalone Deliverable Work Session are absent from the current Router,
HTTP contracts, runtime, and schema. [ADR-0035](decisions/0035-retire-project-deliverable-and-converge-internal-formats.md)
records their retirement. Earlier ADRs remain as superseded evidence; they do not
define an active compatibility path or justify restoring pages, navigation, or user
concepts.

## Current route responsibilities

The Router registers the interface routes below. Update this section in the same
change that adds, removes, or materially changes a page. Root Error and Not Found are
shared states, not separate product routes.

### Public entry

| Route                      | Responsibility                                 | Success destination       |
| -------------------------- | ---------------------------------------------- | ------------------------- |
| `/`                        | Resolve Session and accessible Workspaces      | Recent or first Workspace |
| `/login`                   | Establish Session and recover original goal    | Original goal or gateway  |
| `/invite/$invitationToken` | Resolve and accept an Invitation               | Invited Workspace         |
| `/setup`                   | Initialize an instance with one-time authority | First Workspace           |
| `/account`                 | Manage linked sign-in methods                  | Account                   |

Root Error and Not Found use a shared result pattern: one business reason, one primary
recovery action, and a return entry only when useful. They never show stacks, request
details, or internal routing information.

### Studio

| Route                                                    | Responsibility                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/w/$workspaceId`                                        | Start work and recover recent creation                                          |
| `/w/$workspaceId/new`                                    | Start with a blank Canvas or local image                                        |
| `/w/$workspaceId/agent`                                  | Enter the primary Workspace Agent                                               |
| `/w/$workspaceId/agent/$threadId`                        | Continue a specific Agent Thread                                                |
| `/w/$workspaceId/agents`                                 | Browse reusable Workspace Agents                                                |
| `/w/$workspaceId/agents/new`                             | Create a reusable Agent                                                         |
| `/w/$workspaceId/agents/$agentDefinitionId`              | Inspect an Agent and start work                                                 |
| `/w/$workspaceId/agents/$agentDefinitionId/edit`         | Update and publish an Agent                                                     |
| `/w/$workspaceId/libraries`                              | Find active or archived shared reference libraries                              |
| `/w/$workspaceId/libraries/$libraryId`                   | Browse files; create/edit TXT or Markdown; stage changes and save them together |
| `/w/$workspaceId/skills`                                 | Browse reusable Skills                                                          |
| `/w/$workspaceId/skills/new`                             | Create a Skill Draft                                                            |
| `/w/$workspaceId/skills/$skillDefinitionId`              | Inspect a published Skill                                                       |
| `/w/$workspaceId/skills/drafts/$skillDraftId`            | Inspect a Skill Draft                                                           |
| `/w/$workspaceId/skills/drafts/$skillDraftId/edit`       | Edit, validate, and submit a Skill Draft                                        |
| `/w/$workspaceId/boards`                                 | Browse and resume Canvas Drafts                                                 |
| `/w/$workspaceId/boards/$canvasDraftId`                  | Create, recover, and edit a Canvas Draft                                        |
| `/w/$workspaceId/assets`                                 | Browse manageable Assets                                                        |
| `/w/$workspaceId/assets/$assetId`                        | Inspect current version, provenance, reuse                                      |
| `/w/$workspaceId/brand`                                  | Manage Workspace Brand Draft and Revision                                       |
| `/w/$workspaceId/workflows`                              | Browse and create Workflow definitions                                          |
| `/w/$workspaceId/workflows/$workflowDefinitionId`        | Edit, validate, test, and publish Workflow                                      |
| `/w/$workspaceId/workflow-templates`                     | Browse published production templates                                           |
| `/w/$workspaceId/workflow-templates/$workflowRevisionId` | Inspect, run, or derive a published Revision                                    |
| `/w/$workspaceId/workflow-runs`                          | Browse the current user's production runs                                       |
| `/w/$workspaceId/workflow-runs/$workflowRunId`           | Inspect input, progress, results, recovery                                      |

### Workspace administration

| Route                                          | Responsibility                                    |
| ---------------------------------------------- | ------------------------------------------------- |
| `/w/$workspaceId/settings`                     | Show accessible administration entries            |
| `/w/$workspaceId/settings/general`             | Edit Workspace identity                           |
| `/w/$workspaceId/settings/people`              | Manage members, invitations, and roles            |
| `/w/$workspaceId/settings/usage`               | Inspect budgets, usage, and unsettled cost        |
| `/w/$workspaceId/settings/providers`           | Manage provider settings and secret lifecycle     |
| `/w/$workspaceId/settings/models`              | Manage model defaults and bindings                |
| `/w/$workspaceId/settings/models/available`    | Inspect currently available models                |
| `/w/$workspaceId/settings/model-resources`     | Manage Browser model resources                    |
| `/w/$workspaceId/settings/resource-sources`    | Manage external resource sources                  |
| `/w/$workspaceId/settings/capabilities`        | Manage capabilities and their current run methods |
| `/w/$workspaceId/settings/runs/$workflowRunId` | Diagnose one Run with bounded technical detail    |

Run diagnostics helps administrators understand and recover execution. Ordinary Run
detail helps creators understand progress and results. Neither duplicates the other,
and ordinary pages do not expose providers, Attempts, or internal observations by
default.

## Core user journeys

### First instance setup

```text
Deployment operator issues an email-bound one-time setup link
-> intended administrator opens the link
-> create the bound account or sign in to an existing account
-> create the first Organization and Workspace
-> enter the Workspace as Owner
-> create private, email-bound invitation links for teammates
```

- Public sign-up remains closed; the first public visitor never claims an instance.
- Login uses a clean `/setup` return path and never carries the raw setup key.
- Account creation is available only to email-bound setup grants. Other grant modes
  require an existing account.
- Setup redemption creates Instance, Organization, and Workspace authority in one
  transaction and consumes the grant once.

### Login and Workspace recovery

```text
Open a target page
-> query Session
├── signed out: go to Login and retain a nonsensitive returnTo
└── signed in: query accessible Workspaces
    ├── target allowed: recover the original target
    ├── another Workspace allowed: enter an accessible Workspace
    └── no Workspace: show the authenticated awaiting-access state, recheck, and sign out
```

- Session expiry preserves the current nonsensitive intent and restores it after login.
- Active Workspace is a UI preference; every Server command reauthorizes independently.
- Logout clears query cache, in-memory CSRF data, and recent-Workspace preference.

### Account-only registration and access assignment

```text
Instance Administrator opens registration for verified email and/or selected OIDC providers
-> employee verifies email or completes first OIDC sign-in
-> verified Authentication Account and HumanPrincipal are created
-> no Workspace Membership exists, so the employee sees “awaiting access”
-> Instance Administrator opens Access management
-> select one or more Workspaces and a non-owner role
-> one transaction creates or restores Organization and Workspace Memberships
-> employee rechecks access and enters an authorized Workspace
```

- Registration and Workspace access are separate actions and separate audit facts.
- Account-only registration never creates a personal Workspace or chooses a default
  team on the user's behalf.
- A revoked user with no remaining active Workspace returns to the same awaiting state
  and can be explicitly restored by an Instance Administrator.

### Starting creation and Canvas

```text
Home or Start creating
-> blank Canvas or local image
-> create or recover Canvas Draft
-> edit, invoke an atomic capability, or apply Brand
-> explicitly preview and choose add, replace, save, or discard
-> autosave with refresh recovery
```

- Upload, create, execute, and adoption actions have stable idempotency semantics.
- Closing a page does not treat a committed Run as cancelled.
- Provider URLs, Storage keys, and intermediate Artifacts do not enter Canvas documents.
- A result never overwrites current content automatically; a conflict or authority
  loss stops the write and re-reads authoritative state.

### Asset reuse

```text
Open Assets
-> browse Assets and their adopted current versions
-> inspect provenance and available actions
-> download or use as new creative input
```

The library contains user-managed Assets, not every intermediate Run output presented
as finished work. Reuse retains Artifact and Asset lineage. Deletion and archiving
require retention, references, and legal-hold semantics.

### Workflow production

```text
Author: Workflow Draft
-> visual execution flow and input/output contract
-> Candidate tests, checks, and review
-> immutable published Revision

Runner: production template or published entry
-> provide business input
-> create Workflow Run
-> inspect active, completed, failed, or incomplete state
-> use output or continue recovery
```

- Authoring may expose graph structure and validation; ordinary production does not
  expose nodes, providers, or internal execution.
- Templates run published Revisions only. Drafts and Candidates do not enter ordinary
  user paths.
- Production templates, My runs, and Workflow authoring are different tasks, not
  modes hidden inside one page.

### Brand

```text
Create or select Brand
-> edit Draft
-> publish immutable Revision
-> set Workspace default or choose for a new creation
-> Canvas or Workflow pins the Revision
```

Brand is Workspace creative context, not a duplicate Asset library. Existing Canvas
and Workflow Runs pin versions; later publication never silently rewrites history.

### Workspace administration

- Entries use permission projection, while every command reauthorizes independently.
- A secret is entered only for creation or rotation and is never echoed later.
- Owner, member removal, provider, budget, and route changes state their impact and
  offer conflict recovery.
- Administration shows business conclusions first. Raw logs and technical evidence
  appear progressively only in authorized diagnostic layers.

## Page-state contract

Before implementing a page, define:

```text
Primary user
Primary object
Primary decision
Entry conditions
Server projection
Available commands
Pending behavior
Success destination
Failure and conflict recovery
Permission-loss behavior
Refresh and deep-link recovery
Keyboard and focus return
Empty and first-use state
```

Pages consume bounded business projections. Internal IDs may locate a route or request
but do not become titles, descriptions, notifications, empty states, or ordinary table
columns. Raw errors map to stable, actionable product feedback.

## Maintenance rules

1. Update the route table with Router changes; do not keep a separate phase ledger.
2. Before removing a page, identify its replacement entry, deep links, and recovery
   impact.
3. Give a business object a page or primary entry only when it owns a distinct,
   high-value task.
4. Keep one-off page analysis in task context or `artifacts/audit/<scope-date>/`; move
   only durable conclusions here.
5. Browser evidence records URL, identity, data, and time. Historical screenshots do
   not prove current behavior.

## Agent-first Workspace entry

Home (`/w/$workspaceId`) is an independent entry page in the conversation shell.
It uses the standard `AgentComposer` without internal style overrides. Its wider
layout contains the Composer, example tasks, Agents and Skills. Conversation
history remains in the sidebar rather than being duplicated on Home. Agents use
their configured avatars in open rows; Skills use their configured cover with
text below. A Skill without a readable cover uses a compact icon/text entry.
Capability entries have no border, card background, or status chrome. The standard
Composer has an independently bounded input width. With at most two entries per
kind, the two capability sections share a desktop row rather than reserving two
full-width shelves. Single-item sections omit View all. Skill summaries show the
first sentence without changing stored presentation metadata.

Home prepares work, but never submits a Run. Continuing from its Composer stores
text and uploaded attachments in the existing draft format and navigates to
`/w/$workspaceId/agent?draftId=...`. The user reviews and sends from that empty
conversation. Only an accepted message enters `/w/$workspaceId/agent/$threadId`.

Selecting an Agent or Skill opens a separate fresh conversation with that
capability, preserving the Home draft. Example tasks come from runnable Skills'
`exampleRequests` and additionally prefill editable text. The Agent catalog has
no example-task field. Capability directories remain in the resource area.

The sidebar places Home below New conversation and above Agents and Skills.
Only the exact home route selects Home. Existing conversations do not display
Home discovery content. Empty collections collapse; failed collections offer a
local retry without blocking the Composer.

The built-in default Agent uses the site logo across Agent identity surfaces.
Home excludes it from capability discovery because the primary Composer already
provides its entry point; it remains available in Agent directories and pickers.

Skill thumbnails use a 16:9 slot capped at 320px wide (180px high), including
single-item sections. Below 320px of available space they shrink proportionally.
Columns depend on available container width, not on browser width or item count.
A mixed cover/no-cover shelf reserves matching image slots to align titles; an
all-unillustrated shelf uses compact icon/text entries. Missing, unavailable,
unreadable, or undecodable images retain the same slot with an icon fallback.
Covers load the original artifact rather than the compressed preview. All aspect
ratios use centered contain sizing: preserve the whole image without cropping or
stretching. Any unused space belongs to the neutral cover slot.
