# Runtime configuration governance implementation

Confirmed with the user on 2026-10-10 through the grilling decision rounds.

## Accepted behavior

- Instance administrators govern result download origins and switches, plus Agent
  model/tool call limits and timeouts. Initial limits are 50/100/600 seconds.
- Activated administrator settings automatically replace legacy origin rules. The
  deployment emergency switch, protocol, address, DNS, redirect, size and timeout
  protections remain independent. No source-selection variable is required.
- Per-model-service rules are scoped to Workspace and Provider endpoint. Missing
  overrides inherit the instance rule. Instance pause disables every service.
- New runs, including old-thread new messages and regenerate/retry, use the latest
  activated policy. Existing running/waiting runs keep their original budget.
- Every new result download reads the current policy and uses that snapshot for
  its transfer/retries. Missing configuration fails closed.
- Import existing deployment settings, review, then explicitly activate. Saving
  migration preparation does not activate governance. Activated governance cannot
  roll back into implicit legacy defaults.
- Publish atomically with expected-version checks, reason, immutable revisions
  and audit. Restoring old content creates a new revision.
- Manual result recovery fetches stored result URLs only, never generates again;
  retain historical failure and report recovery separately.
- Admin UI shows effective settings and sources before editing; distinguish saved
  policy from observed Worker configuration. Keep technical details secondary,
  preserve failed edits, and review the concrete changes before publication.
- No commit, push or deployment is authorized by this implementation goal.

## Implementation delivered

- Immutable revisions, instance administrator revalidation, optimistic concurrency,
  publication/restore audit, explicit activation and deployment import.
- Agent admission and regenerate use the current policy; persisted timeout snapshots
  prevent waiting/resume from deriving a larger budget from elapsed wall-clock time.
- Per-service download policies, emergency deployment disable, fail-closed reads,
  per-transfer policy decision evidence and Worker observations.
- Retained upstream result evidence precedes download filtering for all three image
  protocols, including successful tasks. Timeline exposes origins and counts only.
- Owner-authorized manual recovery queues retained links, uses GET only, rechecks
  authority and leases, validates storage content, then atomically commits the
  artifact and recovery success. The original failed task remains unchanged.
- Admin UI reviews before/after values, preserves edits on concurrent publication,
  validates origins inline, and distinguishes saved values from node observations.
  Recovery is available in failed task details and the operational detail page.

## Validation evidence (local, 2026-10-10)

- Disposable MySQL: publication, activation, rollback, concurrent writers and revoked
  administrator; new-run and regenerate admission; waiting timeout snapshot;
  recovery idempotency, owner checks, wrong lease rejection, verified upload commit,
  artifact provenance and unchanged original failure; redacted policy timeline.
- Worker tests: all three image protocols, retained links, scoped download policy,
  fail-closed reads and GET-only recovery/expired/blocked cases.
- Web tests: migration import, diagnostics, failure details and recovery states.
- Existing Chrome extension: local login, import, save, change, restore-as-new-version,
  activation, effective 50/100/600, deployment versus instance source, observed v4,
  inline invalid-origin errors, and actual page appearance.
- Local database migrations 0014–0017 were applied during initial acceptance.
  Source selection now follows activation automatically.

Type checks for Server, Worker, Web and Database passed. Changed TypeScript files
passed ESLint; architecture, environment-contract, documentation-link and UI-boundary
checks passed. The repository-wide complex inline-handler check still reports
pre-existing violations in unrelated pages; the new runtime configuration page has
no remaining violations. The maintainer-language check also flags only existing
content in the Web development README and visual-identity acceptance document.
No baseline exceptions were added.

No paid generation or production recovery was performed. Lost historical result
URLs cannot be reconstructed. Retained links can expire upstream. Original evidence
is bounded to 16 links of 8192 characters each; omissions remain explicit.
No git commit, push or deployment has been performed.

## Deployment and activation runbook

1. Apply migrations 0014–0017 and deploy matching Server and Worker code.
2. Open **Site administration → Runtime configuration**, review the imported origins
   and 50/100/600 limits, add a reason and save with activation enabled. New tasks
   and downloads then use the saved settings automatically. Existing activated
   settings also take effect automatically when upgrading from the earlier design.
3. No environment source switch or additional process restart is required. Keep
   deployment emergency disable available; legacy origins apply only before activation.
4. Runtime feedback reports what processes have read. Reports may take 30 seconds;
   absence of a recent report is not proof that saving failed. Persistent legacy
   reports after activation can indicate processes still running the earlier code.
5. To amend origins later, publish a reviewed version. To undo a policy change,
   restore an earlier activated version with a reason; restoration creates a new
   revision. Initial inactive revisions cannot disable governance via rollback.
6. To recover a failed delivery with retained evidence, its owner opens task details
   and chooses **Fetch saved result**. This creates separate recovery records and
   downloads available artifacts without submitting another generation. A blocked
   origin requires an administrator policy correction first; an expired upstream
   URL cannot be recovered by relaxing the allowlist.
7. For emergency containment use the deployment download-disable switch. For
   policy/database unavailability, restore service availability; governed downloads
   do not fall back to environment origins, and Agent admission does not fall back
   to old profile limits after a read error. Existing runs retain their snapshots.

## Shared runtime settings reader

`runtime-configuration-reader.ts` owns activation, source selection, version metadata
and immutable effective snapshots for typed setting groups. The management store
retains publication, validation, authorization and audit. Agent admission binds the
reader to its existing transaction; result transfers read once before I/O; observation
uses the same snapshot metadata. Callers do not inspect activation or choose fallback
sources themselves. Read failures never become an unconfigured snapshot. There is no
cache or distributed configuration service; future caching must specify freshness and
failure behavior per group. Deployment secrets and infrastructure settings stay outside
this module. The former download-only resolver was removed.
