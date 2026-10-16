# Site-managed HTML tools: upload-to-use lifecycle

Status: implementation target. The previous bundled examples are runtime evidence,
not the final tool-management product. This plan supersedes their hardcoded listing
as the product direction; it does not claim the lifecycle is already implemented.

## Product decisions

- A Tool is uploaded and maintained exclusively by site administrators in Site Administration. Kanvas does not
  seed, curate, or promise to maintain a fixed first-party tool collection.
- The two existing example documents remain test/upload fixtures. They must pass the
  same import, checks, publication, authority, and runtime policy as any other upload.
- The site starts with no seeded Tools. Users see an empty catalogue until a site administrator publishes a Tool; uploading is available only in Site Administration.
- Tool identity, presentation, immutable executable revisions, and temporary usage
  sessions are separate facts. A Tool is not a Capability or an Agent built-in tool.
- Tool identity, revisions, publication and maintenance are site-scoped. Usage with platform integrations retains the current user and Workspace execution scope. V1 accepts self-contained HTML; ZIP support is out of scope. External presentation means catalogue/detail
  metadata; unauthenticated public access is not implied.

## End-to-end acceptance objective

A site administrator can upload an HTML document, configure its presentation
and requested integrations, inspect deterministic checks, preview it in isolation,
publish it, share a stable usage URL with an authorized Workspace member, replace it
with a checked new revision, disable it, and later re-enable it. Another member can
find the Tool, understand its purpose and permissions, open a dedicated spacious
usage page, complete work, and recover existing task results after reload or disable.

No user has to modify the Kanvas repository to add, rename, update, or disable a Tool.

## Public metadata

| Field             | Meaning and rule                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable ID         | Immutable, opaque business identity; never derived from filename or slug                                                                                                |
| Slug              | Site-unique readable URL identifier; lowercase letters/digits/hyphens; reserved route words rejected; editable before first publication, stable after publication in V1 |
| Name              | Required display title, editable independently of executable content                                                                                                    |
| Summary           | Optional short explanation for management or help; not shown in the usage grid                                                                                          |
| Description       | Optional longer usage guidance, supported inputs, limitations and examples; rendered as safe Markdown in optional usage help and maintenance                            |
| Icon              | Square identity artwork used in the usage grid and compact navigation; verified uploaded image, with a generated initial fallback                                       |
| Logo              | Optional wider brand artwork for a tool identity or its own interface; defaults to the Icon rather than becoming a second required upload                               |
| Category and tags | Optional discovery metadata; no hardcoded inventory of tools implied                                                                                                    |
| Maintainer        | Site administrator identity retained for management and audit only                                                                                                      |
| Version           | Platform revision number plus optional author version label and release notes                                                                                           |
| Availability      | Draft / enabled / disabled, with readable reason and timestamps                                                                                                         |
| Integrations      | User-facing list of the precise approved Capabilities and data access; no generic permission to call arbitrary APIs                                                     |
| Audit information | Uploaded/updated/published times and actors, maintained by the platform                                                                                                 |

A name, description or Icon update does not rewrite published HTML, permissions, or
historical usage. HTML replacement, executable configuration changes, or permission
expansion produce a newly checked immutable revision. Optimistic concurrency and
idempotency apply to maintenance commands.

## Page responsibilities and layout

### Usage and maintenance are separate product paths

User correction (2026-09-23): prefer the second visual proposal's grid, but reduce
or remove author/time metadata from the usage list. All initial detail proposals
were too heavy and conflated maintenance with use. Do not build them as shown.

| Surface            | Proposed route                | Responsibility                                                                                   |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Usage catalogue    | `/w/:workspaceId/tools`       | Discover enabled, published utilities through a grid containing only Logo/cover and name         |
| Tool use/detail    | `/w/:workspaceId/tools/:slug` | Use the actual tool in the available page space, with a compact trusted header and optional help |
| Management list    | `<site-admin>/tools`          | Maintain uploaded Tools, draft/check states, publication, updates and availability               |
| Create/configure   | `<site-admin>/tools/new`      | Upload and configure a draft, inspect checks and preview/publish                                 |
| Maintenance detail | `<site-admin>/tools/:toolId`  | Edit metadata/Icon/Logo, replace HTML, inspect revisions/checks, publish and disable/re-enable   |

The usage catalogue has a search field and restrained filtering only where useful.
Grid items contain only a Logo/cover and name. A cover is optional, and a Logo or generated initial provides the fallback. A
single clear action enters the Tool; the card itself can be the entry. Author,
update time, revision, checks, unpublished updates and enable/disable controls
belong to management. Do not turn Upload into the consumer page's primary action or
mix a maintainer table into the catalogue. Empty consumer state explains that no
Tools are available; Site Administration owns uploading, configuration, checks, publication, updates and disabling. Workspace owners and administrators gain no maintenance authority from their Workspace roles.

The usage/detail page is the Tool's working page, not an obligatory introduction
page between discovery and use. It must not inherit `max-w-5xl`, a fixed 760px frame,
or the previous metadata-heavy detail layouts. A compact header provides Back to
Tools, identity and a Fullscreen control. The uploaded interface fills the available width
and remaining viewport height. The tool controls its own responsive composition. Fullscreen expands the tool surface, hides the surrounding application navigation, preserves the running iframe/session and provides a clear exit (including Escape); the trusted host owns this control.

Preserve an optional explanation/help surface for genuinely useful instructions,
examples or permissions needed at the time of use. It stays collapsed/secondary;
there is no mandatory hero, screenshot gallery, author sidebar, version history,
permission card or extra Start screen on the usage path. Trusted results can appear
in a dedicated result area when produced, without permanently constricting the tool.

The user-facing Tools entry belongs in the primary use navigation alongside conversation and canvas, outside “Resources and Management”. It is a destination for doing work, not a resource configuration screen. The site-admin entry follows the existing Site Administration navigation; `<site-admin>` above is a placeholder to resolve against the existing router, not a new competing administration shell.

Management is independently authorized and may expose the full maintenance
metadata, draft state, check report, version history and availability commands.
Viewing a management record never substitutes for an authorized runtime session.
Consumer query projections omit maintenance-only data; they do not reuse the full
administrative DTO and simply hide fields in CSS.

## Lifecycle and maintenance semantics

Tool availability and revision readiness are distinct:

- A newly created Tool has no published revision and appears as a Draft to its
  maintainer. Uploading bytes never makes those bytes available for general use.
- Each candidate revision progresses through upload, configuration, checking, and
  either ready or needs-fixes. A ready candidate can be published by an authorized
  publisher. A check result is tied to the exact bytes/configuration/policy version.
- Publishing atomically switches the Tool's published-revision reference. A published
  revision is immutable. Updating an enabled Tool leaves its previous publication
  usable while the next candidate is incomplete or failing checks.
- Already-open usage sessions pin their revision. A routine update affects new
  sessions; it never silently replaces code beneath a person's unfinished work.
- Disabling prevents new sessions and new bridge-triggered execution immediately at
  server authorization. Open hosts observe the disabled state and unload the frame.
- Existing server tasks and Artifacts are retained. Their inspection/cancellation
  remains available through trusted host/task records; disable is not delete and
  does not silently cancel independent work.
- Re-enable requires a still-valid published revision and current platform policy.
  A stale/incompatible revision must be rechecked or replaced first.
- Permanent deletion and a public marketplace are not required for this first slice.

## Permissions and runtime authority

Maintenance endpoints require the existing site-administrator authority on every read and mutation. Workspace roles, including owner/admin/editor, cannot upload, edit, inspect drafts, publish or disable Tools. There is no separately delegated maintainer or publisher role in V1. User catalogue/use access follows signed-in product access and execution permissions; opening a Tool never grants underlying Capability permissions.

Effective runtime authority is the intersection of the published revision's exact
approved integration set, active Tool availability, live Workspace membership,
current user permissions, input/output scope, and existing execution/budget policy.

The UI must show requested integrations before publication and before granting a
usage session. A calculator requests none. An integration-enabled Tool declares
specific Capability identities; the bundled generic example no longer implicitly
receives the full user-invokable catalogue when uploaded.

Every usage session pins Tool ID, revision ID/digest, Workspace, Principal,
permission scope, policy version and lifetime. Server endpoints bind new executions
and returned task IDs to that session. Client-provided Workspace, slug, run ID or
permission declarations are never authority. Disable/revocation is checked on each
new operation, not solely when the iframe is first loaded.

## Upload and checks

The initial profile accepts a bounded UTF-8 self-contained HTML document. CSS and JS
may be inline; externally fetched scripts/fonts/styles are not silently enabled.
Logo/cover assets use verified image ingestion and site-owned storage references rather than an unchecked remote URL. Their ownership and retention must not depend on an arbitrary Workspace administrator.

Upload enters quarantined private storage. Reuse the storage verification and audit
patterns, but keep executable HTML Tools distinct from Skill packages, which
intentionally reject runnable HTML. Do not relax the Skill archive allowlist.

Checks report three separate facts:

1. Import validity: encoding, size, document structure, permitted resource forms,
   unsupported package dependencies, and metadata/slug consistency.
2. Configuration readiness: declared integrations are precise, supported and
   authorized; image metadata is verified; required presentation is complete.
3. Runtime compatibility: isolated preview loads, requested bridge protocol is
   supported, and errors/timeouts have a recovery action. Static checks do not prove
   arbitrary JavaScript is harmless or that a real paid model invocation succeeded.

The system does not automatically run paid capabilities during checking or preview.
A check pass is a compatibility/policy result, not an unrestricted safety certificate.
Error messages identify the file/field/reason and the next correction; replacing a
failed candidate preserves the Tool's presentation and prior valid publication.

## Isolation gate before enabling arbitrary uploads

The platform, not the uploaded HTML, owns the runtime document policy. Serve uploaded
content through a controlled runtime response with enforced CSP/sandbox, opaque
origin isolation, no platform cookies or credentials exposed to scripts, and a
narrow per-session bridge. Prefer a dedicated credential-free runtime origin in
deployment; direct navigation to a raw stored HTML URL must not create a same-origin
executable application.

Keep scripts inside their frame. Do not enable `allow-same-origin`, forms, popups,
top navigation or arbitrary downloads to make a package pass. Verify embedding and
frame-navigation policy as well as fetch/resource CSP: blocking `fetch` alone is
not a complete data-egress guarantee. Navigation must revoke bridge access. Platform
responses, not author-provided `<meta>` tags, enforce the policy.

V1 must test CSS reset/global styles, duplicate IDs/global variables, parent/sibling
DOM access, unauthorized messages, navigation/reload, external resource attempts,
expired grants, cross-Workspace IDs, and disable while the page is open. Bound
message size, concurrent operations, execution costs and file size. An iframe does
not guarantee hard CPU/memory isolation; heavy work should use cancellable Workers,
and the host must provide an escape/reopen action.

## Visual selection gate (user direction, 2026-09-23)

Before implementing the Tools catalogue and usage/detail interfaces, generate visual concepts
that follow the existing Kanvas design system and show the independent page
structure. Wait for the user to select/approve the visual direction, then implement
those screens. The selected grid direction requires a revised, lighter usage-only
proposal following the latest separation of maintenance and use. This is an explicit user approval gate, not an inferred restriction.
Backend/domain/runtime work may continue independently; a preview is not approval.
Do not fill the concepts with an official first-party catalogue: sample content
represents tools uploaded by site administrators, not a fixed official inventory.

## Implementation order and done gates

1. **Domain and contract:** Tool/revision/session facts, presentation fields, scoped
   slug rules, permission model, state transitions, and migration. Gate: authorized
   commands, IDOR/revocation, idempotency, and concurrent edits tested against MySQL.
2. **Upload and checks:** private ingestion, authoritative checks, Icon/Logo input,
   candidate replacement and publication. Gate: malformed/oversized/unsupported HTML
   produces actionable failure while the previous version remains usable.
3. **Runtime:** trusted sandbox response, per-revision Capability allowlist, server
   session checks, task lineage/recovery and disable propagation. Gate: hostile
   fixture tests cannot affect host/sibling UI or acquire broader authority.
4. **Product pages:** independent list, spacious detail/use pages, and maintenance
   flow in both product locales. Gate: desktop and narrow-screen user journeys are
   browser-verified without internal configuration leaking into ordinary use.
5. **Full acceptance:** upload calculator and communication examples through the
   actual UI, configure metadata/Icon/slug, inspect checks, publish, discover/use,
   replace a version, disable an open tool, retain/query/cancel prior work, re-enable,
   and restore after refresh. No hardcoded fixture registration may bypass a step.

Implementation is complete only when all five gates have current evidence. Document
browser evidence, actual task/Artifact facts, invocation counts/charges where used,
and the precise supported import/runtime profile. Preserve unrelated worktree edits
and do not push unless requested.

## Superseding correction and implementation alignment (2026-09-23)

The latest user decision is authoritative: only site administrators maintain tools, inside Site Administration. Consumer list tiles contain Logo/cover plus name only. The use page has one compact Header and the tool body, with fullscreen support.

The earlier unvalidated Workspace tool migration and contracts have been replaced with site-owned tool identity/revisions/images, site-unique slugs and separate lean consumer contracts. Workspace tool-maintenance permissions were removed. The migration was first exercised in disposable test databases and has now also been applied to the local development database. Administrator-only maintenance endpoints and minimal consumer queries are now connected to the database runtime. Tool image upload and authorized read endpoints are also connected; user/Workspace-scoped execution sessions are now integrated with run creation; runtime document delivery and browser integration remain unfinished. Publication availability and requested capability declarations cannot assume every Workspace has the same capability bindings; resolve and authorize integrations in the active execution Workspace.

Visual revision: `option-2-revised-site-admin.png` retains the selected grid direction and shows the consumer path only. Pending user visual approval; no implementation approval is inferred from generation.

### Current foundation evidence

- Contracts compile; two contract tests reject administrative field leakage and client-selected ownership.
- Six HTML inspection tests pass, including the two real fixtures, malformed content, dependency rejection, non-execution of uploaded JavaScript and warning-limit bypass prevention.
- Two image ingestion tests pass: raster normalization strips metadata/trailing active bytes; vector, corrupt and oversized input is rejected. Images are normalized PNG, bounded to 512 KiB storage.
- Three disposable MySQL tests pass after applying the complete migration inventory: no Workspace required for Tool identity, per-site uniqueness and cross-site revision isolation, publication requirements, zero-call preview sessions. The runner cleaned up its isolated database.
- Server typecheck and lint on the changed foundation files pass. These checks do not prove the unfinished HTTP lifecycle, sandbox runtime or browser journey.

### Maintenance API and consumer-query evidence

- `/api/v1/instance/tools` and tool subroutes now support site-administrator list/detail, creation, presentation changes, HTML upload, revision configuration, server-generated inspection, publication and availability changes. Mutation headers require CSRF and idempotency, not a Workspace ID.
- Every database operation revalidates active site authority. Site maintenance is serialized with optimistic tool versions; idempotency receipts and audit events commit with the mutation. Published source is not changed by replacement uploads. Slugs become stable after publication.
- `/api/v1/tools` and `/api/v1/tools/{slug}` require live user Workspace membership but return only the consumer projection. Draft/disabled/incompatible publications are excluded, including bookmark access. Dedicated session endpoints create pinned runtime authority separately from these catalogue reads.
- Five lifecycle MySQL tests pass in a disposable database, covering concurrent identical retries, changed-request conflicts, inspection invalidation, stable publication during replacement, disable/re-enable epochs, administrative and consumer projection separation, membership revocation and site-administrator revocation. Three separate schema tests also pass.
- Four maintenance controller tests and four existing site-administrator guard tests pass. App-module registration integration passes. Contracts, database build, server typecheck and targeted lint pass; three contract tests include the site-only mutation-header boundary. OpenAPI and browser API types were regenerated.
- Remaining: capability selection across execution Workspaces; runtime document policy, session creation and bridge authorization; selected UI implementation after visual approval; full browser lifecycle acceptance. At that earlier checkpoint the shared development database had not yet been migrated, and no additional paid capability call was made.

### Logo and cover persistence evidence

- Site administrators can upload normalized artwork through `/api/v1/instance/tool-images` and read it through `/api/v1/instance/tool-images/{imageId}`. Request identity, current administrator authority, per-site storage bound and audit writes are checked transactionally.
- User image reads through `/api/v1/tool-images/{imageId}` require live Workspace membership and a current reference from an enabled, checked publication. Unattached or draft-only artwork is unavailable. Responses contain only bounded, normalized PNG content and dimensions/digest; original uploads are never returned.
- Six disposable MySQL lifecycle tests pass, now covering image upload retries/conflicts, non-administrator upload denial, unattached-image exclusion, publication visibility, disable and revoked-member reads. Five maintenance-controller tests, two image normalization tests and app-module integration pass; server typecheck and targeted lint pass. Generated API descriptions are current.
- Runtime session authorization is now implemented and tested below. Browser document isolation and bridge integration remain unfinished; database evidence alone does not prove browser containment.

### Runtime authority and lifecycle evidence

- Tool sessions pin a checked revision/digest, policy version, site, Principal, authentication reference and (for use) Workspace. Preview uses site-administrator authority and grants no capabilities or executions. Normal sessions resolve approved contract keys/digests into the active Workspace and require live capability permission when integrations are present.
- Sessions expire after one hour, can be closed, and permit at most three runs when integrations are granted (zero for isolated utilities). At most 20 active sessions per person/site may coexist. Opening and closing are audited; creating a session is idempotent.
- Updating a publication preserves the old immutable revision for existing sessions. Draft preview replacement or publication invalidates the corresponding preview. Disable and re-enable advance the execution epoch; re-enabling does not reactivate old sessions.
- `CapabilityRunStore.createDirect` checks tool session identity, availability, policy, exact capability grant and run count within its own transaction. The session/run reference is committed atomically with the run, attempt, outbox and audit. Direct non-tool callers retain their prior request hash behavior.
- User session APIs expose creation/read/close, granted capability discovery, start/status/cancel. Discovery filters by approved IDs before catalogue limits. Run status/cancel first verify session lineage, and remain accessible for the session's existing runs after disable/expiry as long as the user's authority remains valid. Preview APIs are separate and site-administrator-only.
- Eleven tests across three disposable MySQL suites pass, including actual concurrent same-key run creation and disable/run competition. Rejected operations produce no dispatch events. No Worker or paid provider runs in these tests.
- Four tool-session controller tests pass: browser-context scope, server-selected use versus preview, capability filtering, ungranted start rejection and unrelated-run read/cancel rejection. Existing capability controller and app-module registration tests pass. Database build, server typecheck and targeted lint passed during this slice; OpenAPI and browser API types were regenerated.
- Controlled runtime routes and a hostile real-browser probe are now implemented below. Product host/bridge integration and authenticated browser lifecycle acceptance remain incomplete.

### Controlled runtime document evidence

- Runtime host/content routes are separately authenticated for user sessions and administrator previews. They accept only iframe navigation, reject query payloads and service bearer requests, and obtain Workspace scope from a validated path before normal membership authorization. A second store check protects the actual HTML read after the host was initialized.
- The trusted outer document contains only platform loader code, a nonce CSP, explicit parent origins and the exact permitted child-document path. The inner document has both an iframe sandbox and an HTTP `sandbox allow-scripts` policy, without same-origin authority. Resource/connection/frame/form/base policies are platform response headers; author meta tags cannot relax them.
- A one-time MessageChannel handshake validates the parent window and origin. The outer loader owns both relay endpoints, bounds messages, and closes/removes the inner frame after reload/navigation. Only the trusted outer document receives same-origin access; uploaded code does not.
- Real Chrome extension probe passed: parent/top DOM access, cookies and local storage denied; child global CSS/variables did not alter the trusted page; fetch, external script/image, Worker fetch and self/top navigation attempts did not reach the local sentinel. Reload and blocked navigation disconnected their relays. The top-navigation case included an actual browser button click.
- Evidence: `.tmp/external-tools/runtime-isolation-evidence.json`, reproducible harness `.tmp/external-tools/runtime-probe.mts`. This is an isolated probe using the production document generator, not proof of authenticated end-to-end product operation. It does not claim a general network air gap or hard CPU/memory containment.
- Three document-policy tests, three runtime request-guard tests, three runtime controller tests and app-module integration pass. Server typecheck and targeted lint pass. OpenAPI now describes the HTML responses as `text/html` while existing route responses retain their default JSON media type.
- Reference semantics: [CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) and [CSP frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src). Actual browser evidence above is limited to the listed probes.
- Remaining: integrate the tested host-side session transport/recovery and disable polling into approved pages; administrator capability selection; approved product pages and full authenticated upload-to-disable browser acceptance. Migration 0007 was subsequently applied to the shared local development database; see authenticated acceptance evidence below.

### Frontend session infrastructure evidence

- Added a scoped runtime API client. Preview calls use administrator routes without Workspace authority and cannot invoke model capabilities. User calls use tool-session endpoints, not the generic user capability routes. Browser credentials and CSRF remain host-side.
- Session creation saves its operation identity before sending. Lost responses retry the same revision/key across reloads; concurrent opens coalesce. Unavailable sessions are not silently replaced. Explicit reopen handles definitive rejection or an old login's missing session, while retaining unresolved creation receipts.
- Task receipts are scoped by Principal, Workspace/preview context and tool session. A later rejection no longer erases a previously uncertain submission. A known server-recorded run can be restored if browser run storage was lost; a still-running task blocks a duplicate start. Uploaded tools may use their explicitly approved structured input contracts, while the old basic example keeps its basic-form filter.
- The headless frame connector validates exact frame/origin, owns the private port, watches session authority, unloads on disable/expiry or verification failure, and requests server closure on runtime navigation. Local disposal preserves a session for reload recovery rather than automatically creating another one. These are infrastructure modules, not an implementation of the pending visual proposal.
- Twenty-eight external-tool frontend tests pass; web typecheck and targeted lint pass. Tests cover uncertain submit recovery, first definitive rejection, scoped storage, read/close routes, capability filtering, frame origin checks and fail-closed unloading.
- Real Chrome probe using the production frontend connector plus production isolated document generator passed: simulated disable changed the actual iframe to `about:blank`; reload/navigation disconnected it and requested session closure; activated top navigation remained blocked; sentinel request log stayed empty. Evidence: `.tmp/external-tools/runtime-connector-evidence.json`. The API state was simulated, so authenticated end-to-end acceptance remains outstanding.

### Administrator capability selection and authenticated HTTP acceptance

- Added an administrator-only capability reference catalogue with Workspace/search filtering, localized labels, stable contract key/revision/digest and bounded results. It lists active, published user-invokable contracts; selecting a reference still does not grant the consumer execution permission. Real MySQL coverage verifies selection, filtering and stale-administrator rejection.
- Applied additive migration `0007_site_tools.sql` to the local development database after verifying it was the sole pending migration. Migration state is current. No existing table was replaced and no fixed Tool inventory was installed.
- Started the built API on independent local port 3100, preserving the existing port-3000 service. Using the existing development administrator, 68 authenticated HTTP requests passed: image upload/visibility, both actual HTML fixture uploads, check idempotency, preview with zero grants, publication, lean consumer projection, cross-login session rejection, enforced runtime headers/direct-navigation rejection, invalid replacement recovery, pinned old revisions, disable/re-enable, precise capability discovery and denied invocation paths.
- Evidence: `.tmp/external-tools/live-lifecycle-evidence.json`. The test created only `[redacted-resource-id]` and `[redacted-resource-id]`; both were disabled and their final state was read back. No approved capability was invoked, and tool session run lists remained empty. The original paid-call acceptance is separate; no additional paid call was used here.
- Architecture and documentation-link checks pass. Maintainer-language checking found the plan's quoted Chinese navigation-group label; it was replaced with its English equivalent in the English-maintained plan. The user-facing Chinese navigation requirement is unchanged.
- The visual confirmation question is pending. Remaining product work is the site-administration maintenance UI, approved consumer grid/use page/fullscreen integration, and authenticated browser acceptance of the complete journey. Backend HTTP and isolated Chrome probes do not substitute for that product acceptance.

## Visual approval

The user approved the latest revised direction (2026-09-23) and authorized implementation. The visual gate is cleared. Proceed with the consumer grid, compact use header/fullscreen surface, and separate Site Administration maintenance flow.

## Authenticated browser acceptance completed

The approved site-administrator/user split is implemented and accepted in the logged-in in-app browser. Chrome extension control remained unavailable, so the user logged into the preview explicitly.

- Administrator-created `calculator` and `capability-demo` are uploaded records, not seeds or built-in inventory. Calculator id: `[redacted-resource-id]`.
- Creation, HTML chooser upload, check, isolated preview, publication and user catalogue navigation passed through actual UI controls.
- Calculator returned 15 for 12 + 3. Entering/exiting fullscreen retained the result. Disabling from another page automatically removed the active frame; re-enabling required explicit reopening.
- Calculator version 2 (label `1.1`) was uploaded, configured, checked and published. Both version records remain visible. Presentation and version edits saved together; unsaved edits are protected from conflicting operations.
- Capability tool's configured allowlist exposed only the selected text-to-image capability. Its administrator preview could not run capabilities. Uploaded logo and optional help appeared on user surfaces.
- Real uploaded-tool run `[redacted-resource-id]` completed with exactly one Provider invocation. Refresh restored the same task and inputs. Artifact `[redacted-resource-id]` was previewed at 1024 × 1024 and downloaded through the browser.
- Download: 1,199,248 bytes; SHA-256 `715aa0a4efdc4d8f63a1b5655778a5729d76d5af0c897f2d998f3eb631b83d1d`. Actual charge USD 0.012. Including the prior prototype acceptance, the authorized two-call allowance is exhausted: total USD 0.024. Do not submit another model invocation without renewed authorization.
- Current scoped validation: 35 tests passed, web TypeScript passed, changed UI ESLint passed, production Vite build passed (existing chunk-size warnings remain). Prior server/database lifecycle and isolation evidence still applies. Visual acceptance is in root `design-qa.md`.

### Local environment recovery boundary

System DNS repeatedly returned ENOTFOUND for the configured public S3 hostname. Public DNS and a TLS HEAD against a returned address succeeded. The temporary `.tmp/external-tools/worker-dns-fallback.mjs` supplies that verified address only inside the local acceptance processes; URL, Host, SNI and certificate validation are unchanged. It is not imported by production code and must not be deployed or treated as a permanent DNS fix. The final content read returned HTTP 200 and 1,199,248 bytes. API, Vite and provider/outbox workers were left available locally. No production deployment, push or system network setting change was performed.

## Preview-first management redesign delivered

The user-approved redesign replaces the earlier field-first maintenance layout. Administrator source read and discard-draft APIs now support the basic single-file editor; the current published file remains previewable. Administrator preview receipts are scoped to the selected revision, preventing a stale published preview from replacing a newly edited draft. Bounded runtime error diagnostics are preview-only; forced sandbox policy is unchanged.

The UI uses one settings/source save action, stages artwork until save, protects unsaved navigation, and removes the non-actionable version-history interface. Tools navigation sits beside Skills and shares an availability rule across primary/resource/mobile surfaces. Empty-catalogue tests hid all consumer entries and rejected old tool URLs; the two original active tools were restored afterward.

Final requirement/evidence matrix and current screenshots are in root `design-qa.md`. The disabled redesign fixture is `[redacted-resource-id]` (`editor-acceptance`). No additional paid capability invocation was made.

## Standalone tool recovery correction

A user reported that the calculator still displayed an internal closed-session screen after availability was restored. The persisted runtime receipt was correctly invalidated by the earlier disable operation, but consumer page entry did not replace that confirmed task-free receipt. `openForDisplay` now automatically recovers confirmed inactive runtimes only when `maximumRuns=0` and no run is attached. Uncertain creation receipts and capability sessions retain identity. Concurrent page opens share the same recovery attempt. The runtime watcher tolerates bounded transient failures without immediately removing the frame, but confirmed authorization rejections still stop immediately. Visible fallback copy uses tool availability and a single retry action, rather than internal connection terminology.

Verification: 31 focused web tests passed, typecheck/lint passed, existing browser receipt opened the calculator without a recovery prompt and computed 12 + 3 = 15. No capability invocation or paid model call was made. This does not claim arbitrary uploaded tools can preserve internal state across a full iframe reload.

## Global header correction

Tool usage pages retain the global AppShell header in normal mode. Only the explicit browser fullscreen action displays the tool surface alone; exiting fullscreen restores global navigation without remounting the tool. The tool heading uses its own ID to avoid duplicating the global header's accessibility target. Verified normal/fullscreen/exit in the browser with calculator result 15 retained, and web typecheck passed.

## Background connection recovery (2026-10-09)

Temporary transport failure is distinct from confirmed loss of authority. The frame
watcher now retains the isolated document and its local input while verification is
unavailable, rejects new bridge requests, and displays a reconnecting notice. It
retries with bounded exponential delay (up to 30 seconds); foreground/online events
request an immediate check. Healthy foreground checks remain every two seconds,
while hidden tabs check every 30 seconds. This changes disable propagation latency
for hidden documents; server authorization still validates each new execution.

Confirmed authorization rejection, unavailable sessions, digest mismatch, host
navigation, and expiry still unload the frame. Expiry has its own timer and is also
checked before bridge execution. Retaining a document during a transport outage
preserves its local JavaScript state; it does not suspend its isolated scripts or
grant offline platform execution. Initial bridge connection waits for both the
trusted host and a successful authority check.

Only confirmed task-free sessions automatically recover from expiry while mounted.
The allowance belongs to the expired session ID, not the lifetime of the page, so
successive sessions can expire and recover without allowing one bad receipt to
loop. Opening/recovery transport retries keep the same creation receipt and
idempotency key, back off to 30 seconds, and stop on definitive rejection or page
cleanup. Capability task receipts remain unchanged. Full iframe replacement on
expiry still cannot preserve arbitrary tool-local input; resumable document state
or in-place authority renewal requires a separate explicit contract.

Validation: focused watcher/opening/session/API/bridge tests cover outage recovery,
blocked bridge calls, background polling, expiry, definitive rejection, late
responses, and reuse of an uncertain replacement's creation key. A local Chrome
fixture using the actual RuntimeSurface preserved typed input and session identity
through an outage, recovered two successive expirations, and stayed stopped after
permission rejection even when an online event followed. The fixture used simulated
APIs; this is not production deployment or paid-task end-to-end evidence.
