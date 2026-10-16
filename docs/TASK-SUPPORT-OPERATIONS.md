# Task support and administrator records

## Findings and scope

The current user failure action only builds a Composer draft. It performs no
diagnosis and carries no structured execution identity. Remove this action.

The existing operational timeline is protected by Workspace `audit.read`, but
accepts only a Workflow Run ID and has no unified directory. Direct capabilities
already persist attempts, provider observations, artifacts and budget facts.
Agent Run diagnostics also exist separately.

## Intended journey

1. A user sees a readable failure and can copy its problem reference, using the
   actual Capability Run or Workflow Run ID. Copying never edits or sends a draft.
2. An authorized administrator opens Team settings > Task records, searches the
   reference, or filters records by kind, state, creator and creation time.
3. The directory includes all lifecycle outcomes for Agent, Workflow and direct
   Capability runs. Workflow node executions remain in their parent's timeline.
4. Workflow and direct Capability details reuse the operational timeline. Agent
   entries reuse Agent Run diagnostics. Correlated run/thread IDs link the facts.
5. Diagnostics show recorded evidence, not inferred remote success. Reading or
   copying a record does not retry execution, invoke a model or change billing.

## Boundaries

Records are scoped to the selected Workspace and require `audit.read` at HTTP
and database boundaries, including authority revalidation. This does not grant
instance administrators automatic access to other Workspaces. Lists are bounded
and paginated. Safe operational facts exclude credentials and raw provider bodies.
No new task state machine or background AI diagnosis is introduced.

## Acceptance

- No failure button appends diagnostic prompts or steals Composer focus.
- A problem reference locates the matching record, including successful runs.
- Filters, pagination, empty/error states and permission denial are explicit.
- Direct capabilities expose attempts, provider observations, result persistence
  and budget facts, with safe error and correlation identifiers.
- Focused API, store and UI tests include cross-Workspace and revoked-authority
  cases. Browser validation uses only the existing Chrome extension session.

## Delivery evidence

- Added Team settings > Task records, visible to `audit.read` operators. Filters
  accept a problem/run/thread reference, creator name or ID, kind, status and
  creation time. Keyset pagination uses the creation timestamp, run ID and kind.
- User failure cards and task details copy the actual execution reference, falling
  back to the Agent Run for a failure before a production run exists. Raw provider
  response bodies and the Composer recovery callback are removed from this UI.
- Direct Capability timelines reuse attempt, observation, artifact, audit and
  usage/budget projections. A completed run without an Artifact commit does not
  invent a saved result. Agent diagnostics retain their existing permission gate.
- Focused Web tests cover failure UI, the four status displays, task detail,
  conversation regressions and settings visibility. HTTP injection verifies route
  registration, valid string query limits and rejection of an oversized limit.
- Disposable MySQL verification passed for direct and Workflow records, successful
  and active filters, reference lookup, pagination, invalid cursors, permission
  downgrade, stale authority, cross-Workspace denial, and actual Artifact commits.
- Web, Server and Database type checks passed; changed TypeScript passed lint.
  Documentation and whitespace checks passed.
- Chrome attachment recovered on retry; the existing local tab showed
  `ERR_CONNECTION_REFUSED` on port 5173. Live application interaction, clipboard
  behavior and visual acceptance remain unverified. No deployment or business
  database mutation was performed. The preceding declaration revision migration
  must accompany the server release; only disposable databases were migrated.

The directory covers the selected Workspace. It does not bypass conversation
ownership or provide a new cross-Workspace instance-admin content permission.

## Task directory interactions

The directory prioritizes locating a reported task and scanning its outcome:

- Reuses the settings header, directory table, filled search/select controls and
  status tags. Reference search is explicit; status/type changes apply immediately.
- Creator and creation range are secondary filters. Applied criteria remain
  visible when collapsed; clearing filters resets the cursor and returns focus to
  search. Date selection cannot implicitly submit the surrounding filter controls.
- Successful Agent and production runs share one status label; partial success
  remains distinct. Total wall time uses readable minutes/hours. Full references
  remain available in details; compact suffixes distinguish otherwise equal rows.
- At narrow widths, status and metadata move into each task row so diagnosis does
  not require horizontal scrolling. Opening details preserves the list state.
- Related Agent diagnostics do not replace the selected production task. Closing
  either drawer restores the triggering button's keyboard focus. Embedded timelines
  omit page-level back navigation and the duplicate oversized run heading.

## Result storage and fee recovery

Image-provider submission checks storage compatibility before reserving funds or
sending the paid generation request. Invocation ownership renews within the
original Attempt deadline; result downloads have separate connection, response
header, first-byte and idle limits (see [Configuration](CONFIGURATION.md)).
A slow transfer with continuing data does not hit the idle limit. Only safe binary
result GETs can try another validated address; generation POSTs are not retried.
Transfers additionally enforce a minimum progress window and a per-address
deadline. Reconciliation has bounded concurrency to isolate slow result downloads.

Confirmed remote success and validated billing facts are persisted on the existing
Provider Observation before downloading the result. Storage failure does not erase
that evidence. The existing budget settlement loop uses the pinned pricing and
confirmed charge/usage, with the existing transactional ledger keys. Unknown
amounts remain held; output-storage failure alone does not justify releasing funds.
A settled queryable invocation can still retrieve its original result.

For URL-based image results, the worker preserves HTTPS output links approved by
the deployed result-download URL policy in the existing `result_facts` evidence
before downloading. These links can contain bearer signatures: do not log them
or include them in operational timelines. Failed Capability details expose only
the current attempt's links after normal Workspace and conversation-owner checks.
Conversation cards and details offer “Generated, but not saved to Kanvas” and an
original-file link, with an expiry caveat. An external link is not an Artifact or
Asset and cannot be used as proof of durable storage. Completed tasks use their
saved outputs; old failures without recorded links and base64-only responses do
not acquire an invented fallback URL. This change does not reissue generation.

After an upload acknowledgement is lost, the materializer rereads the original
upload session and verifies only an existing stored object. Missing objects do not
cause an empty replacement upload. Transient completion-database failures retry
once with the same observation, artifact and completion identities. These steps
never submit another generation request.

Conversation failures remain compact with a View details action. The side panel
contains the support reference, charge caveat and expandable diagnostic code.
Usage holds link directly to their Capability task, including tasks without a
Workflow Run. Historical holds are not automatically released by this change;
they still require trustworthy fee evidence. Query recovery remains bounded by
the original deadline. Unqueryable synchronous results lost before durable storage
cannot be recovered after a process crash.
