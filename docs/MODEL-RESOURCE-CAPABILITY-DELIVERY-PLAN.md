# Model Resource and Capability Delivery Plan

> Historical plan: its Phase 1-15 reviews remain evidence, but its active phase
> sequence and the former no-local-model acceptance boundary are superseded by
> [Model Source to Capability Closed Loop](MODEL-SOURCE-CAPABILITY-CLOSED-LOOP-TASK.md).

- Status: superseded for active delivery — historical evidence only
- Started: 2026-09-01
- Current phase: none — follow the closed-loop task document above
- Scope: model resources, model services, Runtime Adapters, Capabilities, Workflow, Agent, Canvas, and the optional default Catalog

## 1. Outcome

Deliver one production-shaped control plane with this authority chain:

```text
Workflow ─────────┐
Agent ────────────┼─> Capability Contract Revision
Canvas ───────────┘             -> Capability Binding
                                -> Capability Implementation Revision
                                -> Runtime Adapter Revision
                                -> Plugin / Model Resource / Model Service
```

Model resources and model services are lower-level implementation sources. Except for
the Agent foundation text-model choice, Workflow, Agent, and Canvas consume only the
published Capability Contract and never persist Provider, model, Storage, Adapter, or
routing identities.

Workflow, Agent Skill, and Canvas are independent Capability consumers, not installation
wrappers. Workflow owns business-oriented templates such as poster or marketing-image
generation. Capability owns lower-level atomic semantics such as image generation,
denoising, or background removal. Agent Skills may teach discovery and use, while Agent
and Canvas discover compatible Capabilities directly.

The lower-level installation and invocation control plane is corrected and proven before
the official recommendation Catalog is rebuilt. Recommendations must conform to the final
contracts; they must not determine those contracts and are never installed by normal
Workspace bootstrap.

## 2. Non-negotiable boundaries

1. Preserve the runtime authority chain
   `CapabilityContractRevision -> CapabilityImplementationRevision -> CapabilityBinding -> CapabilityRun/CapabilityAttempt`.
2. Preserve the storage authority chain `StorageProfile -> StoredObject -> Artifact`.
3. Published Contract, Declaration, Model Resource, Runtime Adapter, and Implementation
   Revisions are immutable.
4. Development uses the final `0000_initial_schema.sql`. It does not ship old-data
   migration, dual-read, backfill, or compatibility UI.
5. Post-release Contract evolution remains an architecture requirement, but the current
   phase does not prebuild a migration product without real published consumers.
6. Runtime and consumer code must not branch on a specific Capability or model key.
   Adapter- or Provider-specific behavior stays inside the corresponding executable
   adapter boundary.
7. No local model is executed during development or acceptance.
8. Catalog recommendations are read-only source metadata. Only an explicit user install
   creates Workspace-owned Capability, implementation, Binding, and dependency facts.
9. Create a scoped commit at a phase boundary when it materially improves reviewability
   or protects a proven milestone. Do not create commits for intermediate micro-steps.
   Never push without explicit user instruction.
10. Capability installation does not create, install, enable, or repair a Workflow,
    Agent Skill, or Canvas entrypoint.
11. Manual Capability creation is atomic and requires at least one complete run method.
    It creates an installed but disabled Capability; there is no product-level Draft.
12. Installation, enablement, and runtime availability are separate facts:
    recommendation/installed/archived, disabled/enabled, and unavailable/available.
13. Capability and dependency updates are never applied automatically. Historical
    references remain pinned; a revoked dependency may become unavailable without being
    silently replaced.
14. Built-in private algorithms may be installed only with their owning recommended
    Capability. Only explicitly reusable plugins or Runtime Adapters appear when an
    operator adds a run method to a manually created Capability.
15. Model resources are Workspace-owned shared dependencies. Archiving a Capability must
    not cascade-delete a referenced resource; physical cleanup is a separate retained,
    unreferenced-resource operation.

## 3. Execution protocol

Work on one phase at a time. At the end of each phase:

1. update this document;
2. record the actual files and behavior changed;
3. record the checks that were actually run;
4. record remaining risks and any deviation from the plan;
5. stop and present the phase review before starting the next phase.

A phase is complete only when its exit criteria are proven. Passing a build or test does
not substitute for the user-visible or runtime outcome named by the phase.

## 4. Verification budget

Validation is deliberately batched to avoid repeating expensive checks.

### During implementation

- Run only the smallest relevant unit test, type check, generated-contract check, or
  MySQL integration test that can detect the current defect.
- Group related edits before checking them.
- Do not run the full test suite, a complete build, or browser acceptance after each
  file or substep.
- Run contract generation only after a logical set of source-contract changes is
  complete.

### Full repository gates

The historical Phase 4 and Phase 10 gates are recorded below and are not repeated merely
because the correction work has started. For Phases 11–16, the full test suite and
complete build are planned once, in Phase 16 after the corrected control plane, consumers,
Catalog, and operator UI are complete.

An additional full run requires one of these explicit reasons:

- a focused check cannot safely validate a shared schema or contract change;
- a partial check cannot cover a credible repository-wide regression;
- the user explicitly requests it.

The reason must be recorded in the phase review before running the extra full gate.

### Browser acceptance

Use only the existing Chrome extension session. Do not use the built-in browser, start a
new browser, or relaunch Chrome.

The historical Phase 7 and Phase 10 browser evidence is retained below, but it proves the
superseded product path. For Phases 11–16, one browser acceptance is planned in Phase 16,
after the complete settings and Canvas state is available. An earlier browser check is
allowed only when visible evidence is necessary to choose or diagnose an implementation.

Intermediate phases use contract, service, store, and integration evidence. If the
existing Chrome session is unavailable at the Phase 16 gate, record the acceptance as
blocked rather than starting another browser.

## 5. Phase plan

### Phase 1 — Migration-scope audit and architecture freeze

Goal: separate premature migration-product removal from the immutable Revision and
runtime foundations that must remain.

Work:

- classify every current uncommitted path as retained, restored, deferred, or rebuilt;
- remove only development compatibility and premature migration-product behavior;
- preserve immutable Contract Revisions, exact Workflow references, execution-plan
  snapshots, historical Runs, and audit identity;
- quarantine every default Catalog change until Phase 9;
- keep generated artifacts coupled to their source contracts rather than treating them
  as manually authored architecture.

Exit criteria:

- no migration-plan table, Store, Service, API, pending-discovery path, or upgrade UI;
- the Contract -> Implementation -> Binding -> Run/Attempt chain remains intact;
- Workflow and execution facts still pin exact Contract Revisions and digests;
- the current diff has an explicit ownership classification;
- targeted contract, service, store, architecture, and diff checks pass.

### Phase 2 — Model-resource foundation

Goal: prove real model-resource ingestion and publication without the default Catalog.

Work:

- accept local upload and stable HTTPS sources;
- write through the existing Local or S3-compatible StoragePort;
- detect files, byte sizes, SHA-256, media types, format, license, native interface,
  and compatible Runtime Adapters;
- require users to provide only facts that cannot be detected safely;
- publish immutable ModelResourceRevisions referencing sealed StoredObjects;
- reauthorize and reverify Browser and Worker access by Revision and digest.

Exit criteria:

- an empty Workspace can import and publish a resource without a Catalog entry;
- invalid size, digest, source, or lifecycle is rejected;
- ordinary clients do not receive Storage Profile, bucket, object key, local path,
  credential, or durable signed-URL facts;
- targeted Local/S3 contract, import, publication, and download checks pass.

### Phase 3 — Model-service and Runtime-Adapter generalization

Goal: keep Provider-specific behavior inside Provider/Adapter modules and make the
Capability control plane independent of fixed model operations.

Work:

- audit `image.generate` and `image.edit` assumptions in Provider, Route, Binding, and
  Capability code;
- retain operation-specific protocol behavior inside the corresponding Provider or
  Adapter implementation;
- remove specific Capability/model-key branching from generic stores, services, and
  dispatch;
- validate Adapter source kind, execution target, model format, invocation Schema,
  configuration Schema, executable identity, and release digest before publication;
- keep the V1 executable registry compiled into the Worker; do not build a dynamic
  plugin marketplace in this phase.

Exit criteria:

- a new test Adapter can be declared and admitted without changing Capability-core
  code;
- unsupported source/format/target/operation combinations fail at publication;
- generic Capability and Binding stores do not enumerate concrete Capability keys;
- targeted Provider, Adapter, Binding, and architecture checks pass.

### Phase 4 — Capability-core control plane

Goal: complete the business Contract, implementation mapping, and routing lifecycle
without relying on the UI or default examples.

Work:

- freeze the responsibilities of Definition, Declaration, Contract, Implementation,
  and Binding;
- publish bounded public Schemas and explicit Semantic Types;
- compile bounded input/output mappings and validate required fields, types, semantics,
  defaults, and fixtures;
- publish and replace Implementation Revisions without changing the public Contract;
- manage Binding enablement, order, eligibility, health, budget, and fallback;
- pin immutable execution plans for created Runs.

Exit criteria:

- an empty Workspace can create a Capability and publish a run method through the
  control-plane API;
- an unbound Capability is not reported as invokable;
- replacement creates a new Implementation Revision and does not rewrite old Runs;
- targeted MySQL and runtime checks pass;
- the first planned full test suite and complete build pass.

### Phase 5 — Empty-workspace vertical slice

Goal: prove one representative image Capability from lower-level configuration through
runtime facts before building the general UI or examples.

Work:

- start from an empty Workspace with no installed default Catalog;
- import one model resource;
- create one public image Capability Contract and Declaration;
- add and publish at least one executable run method;
- add a second candidate only when it proves replacement, priority, or fallback;
- verify `CapabilityRun -> ExecutionPlanSnapshot -> CapabilityAttempt -> StoredObject -> Artifact`.

Local model inference is not executed. Model-resource admission can be proven through
download and digest checks; an actual invocation uses a deterministic test Adapter or an
already-authorized remote Provider.

Exit criteria:

- no capability-specific bootstrap TypeScript or field-name semantic inference;
- switching the lower-level candidate does not change the public Contract;
- fallback occurs only for snapshot-declared reasons;
- the phase is proven without installing the default Catalog.

### Phase 6 — Workflow, Agent, and Canvas consumption

Correction notice: the shared authority goal remains valid, but the delivered Agent
single-node Workflow requirement and Canvas Skill/Workflow entrypoint dependency are
superseded by Phase 13. The Phase 6 review is retained only as historical evidence.

Goal: make all three consumers use the same published Capability authority.

Work:

- make Workflow nodes pin exact Contract Revision references and digests;
- keep Agent discovery separate from ToolView-authorized invocation;
- validate public Agent input before preparing a governed invocation;
- make Canvas discover by Surface, category, and Semantic Type rather than treating a
  fixed Capability-key list as the catalog;
- consume primary Artifact output through undoable Canvas commands;
- prevent all consumers from persisting lower-level identities.

Exit criteria:

- the same manually created Capability appears to each authorized consumer;
- lower-level replacement requires no consumer edit;
- historical Workflow Revisions remain pinned;
- unauthorized Agent or Canvas callers cannot bypass discovery by supplying a key;
- targeted consumer and execution tests pass.

### Phase 7 — Operator-facing management journey

Goal: expose the proven control plane through task-focused settings pages.

Work:

- show installed model resources separately from optional recommendations;
- implement source -> automatic analysis -> missing facts -> publication;
- show only real Workspace Capabilities and truthful availability states;
- create Capabilities using business metadata and public input/output definitions;
- add run methods by choosing a resource, service, or trusted plugin, then mapping,
  testing, ordering, and publishing;
- use the active interface locale without requiring duplicate bilingual operator input;
- keep internal IDs, digests, Adapter identities, and Storage facts out of ordinary UI.

Exit criteria:

- one complete operator journey works from empty lists through published Capability;
- status labels cannot contradict each other;
- every changed visible string is complete in `zh-CN` and `en-US`;
- the first planned existing-Chrome acceptance passes after the complete page state is
  available.

### Phase 8 — Post-release Contract-evolution boundary

Goal: document the real post-release requirement without prebuilding a migration
product during development.

Work:

- distinguish Declaration changes, implementation replacement, additive Contract
  changes, and breaking Contract changes;
- require historical Workflow and Run facts to remain pinned;
- define the future trigger for impact preview, mappings, new Workflow Revisions, and
  discovery switching;
- align current architecture documents with the code and first-release scope.

Exit criteria:

- documents do not describe migration plans or upgrade UI as implemented V1 behavior;
- documents do not imply that Contract evolution is unnecessary;
- no migration table, API, UI, dual-read, or compatibility runtime is added.

### Phase 9 — Optional default Catalog rebuilt from final definitions

Correction notice: the optional-bootstrap boundary remains valid, but treating packaged
Workflows and Skills as mandatory Capability installation coverage is superseded by
Phase 14.

Goal: create examples only after the manual lower-level and consumer journeys are
proven.

Work:

- rebuild only Capabilities with a real current product entry point;
- use the final ModelResource, RuntimeAdapter, Contract, Declaration, Implementation,
  Binding, Workflow, and Skill formats;
- pin every dependency, Revision, and digest;
- preserve deterministic dependency ordering and idempotent installation;
- separate Workspace bootstrap from optional Catalog installation.

Exit criteria:

- a new Workspace remains empty after normal bootstrap;
- explicit Catalog installation creates exactly the reviewed examples;
- repeated installation is idempotent;
- tests explicitly install the minimum package they require rather than relying on a
  global default-data side effect.

### Phase 10 — Consolidated acceptance and delivery

Correction notice: this acceptance proved the then-implemented path, not the corrected
product architecture. Its automated and browser evidence remains useful as a regression
baseline, but Phase 16 replaces it as final acceptance.

Goal: prove the final repository and representative user journeys once, without
duplicating earlier expensive validation.

Checks:

- generated contracts and generation idempotency;
- relevant and full unit/integration suites;
- architecture, type, format, lint, and code-health gates;
- complete build and distribution verification;
- empty-Workspace behavior;
- explicit optional-Catalog installation;
- model-resource import and publication;
- Capability creation, run-method publication, replacement, and fallback;
- Workflow pinning, Agent discovery/invocation, and Canvas use with undo/redo;
- the second and final existing-Chrome acceptance.

The final report distinguishes automated proof from external S3, Provider, billing, or
browser evidence that was unavailable.

### Phase 11 — Product-boundary correction and plan freeze

Goal: turn the product review into an auditable correction plan before changing runtime
code.

Work:

- preserve Phase 1–10 records without treating the superseded coupling as authority;
- freeze the independent Workflow, Agent Skill, Canvas, and Capability responsibilities;
- freeze the three-axis Capability state model and atomic manual-creation rule;
- define the corrected implementation order and low-frequency validation gates.

Exit criteria:

- the plan contains no unresolved product decision that blocks the lower-level work;
- Phase 6, Phase 9, and Phase 10 drift is explicitly identified;
- no application source or generated contract changes in this phase;
- documentation and diff checks pass.

### Phase 12 — Capability installation and dependency control plane

Goal: make recommendation, installation, enablement, availability, and dependency
ownership truthful without relying on Workflow, Skill, Canvas, or the final UI.

Work:

- separate official Catalog recommendations from Workspace installation facts;
- persist an idempotent, recoverable installation operation with a Catalog-declared
  default route and explicit dependency plan;
- keep first-install failure on the recommendation with retry evidence and no
  half-installed Capability;
- for a model-resource route, confirm, import, verify, and only then atomically install
  and enable the Capability with that selected route;
- for a model-service route, select only an existing operation/modality/adapter-compatible
  model and return a settings destination when none exists;
- install a built-in private algorithm only with its owning Capability and exclude it
  from general run-method selection;
- require a complete run method in the same transaction as manual Capability creation;
- preserve shared resources on Capability archive and keep updates explicit.

Exit criteria:

- a fresh Workspace can see recommendations without installed Capability records;
- manual creation either commits one installed, disabled Capability with a complete run
  method or commits nothing;
- recommended installation activates exactly one selected default route only after its
  dependencies are ready;
- retry, archive, shared-dependency, compatible-model, and no-auto-upgrade behavior have
  focused service/store integration proof;
- no Workflow, Skill, or Canvas record is written by Capability installation.

### Phase 13 — Independent governed consumers

Goal: retain one governed Capability authority while removing fake product coupling
between the three consumers.

Work:

- keep Workflow as an independently authored business template whose nodes pin exact
  Capability Contract Revisions and digests;
- let direct Agent invocation create a governed CapabilityRun without requiring a
  synthetic single-node Workflow Revision;
- keep Agent Skills as reusable discovery/use guidance with no generated one-to-one
  Capability binding;
- let Canvas query enabled, available Capabilities directly by `canvas` Surface,
  selected-element Semantic Type, action group, permissions, and data policy;
- store Canvas placement metadata such as `image editing -> image processing` on the
  governed Capability Declaration rather than in Skill, Workflow, or key-based code;
- preserve authorization, approval, budget, Binding resolution, execution snapshot,
  CapabilityRun/Attempt, Artifact lineage, audit, and undoable Canvas application for
  every direct caller.

Exit criteria:

- Agent and Canvas discover and invoke an eligible manually created Capability with no
  Workflow or Skill entrypoint;
- installing, archiving, or replacing a Capability creates no Skill/Workflow side effect;
- Workflow publication and execution remain revision-pinned and independently operable;
- unauthorized, unavailable, incompatible, or unapproved direct calls fail through the
  shared governance path;
- focused consumer, runtime, and disposable-MySQL tests pass.

### Phase 14 — Official recommendation Catalog rebuilt from corrected definitions

Goal: publish useful official recommendations only after the installation and consumer
boundaries are proven.

Work:

- review each first-release recommendation against a real atomic Capability use case;
- declare one recommended default route and pinned dependencies as Catalog data;
- retain source, version, digest, signature, license, execution-location, and dependency
  metadata needed for an informed install confirmation;
- remove generated or mandatory Workflow and Skill coverage from Capability packages;
- expose recommendations by default without installing them into the Workspace;
- install only the selected Capability and route, not the complete recommendation set;
- expose updates for explicit review without changing installed revisions.

Exit criteria:

- normal Workspace bootstrap installs zero Capabilities, model resources, Workflows, or
  Skills while official recommendations remain visible;
- installing one recommendation installs only its selected route and required lower-level
  dependencies;
- Capability installation has no Workflow, Agent Skill, or Canvas-entrypoint side effect;
- repeated install requests are idempotent and Catalog updates never auto-upgrade an
  installed Workspace fact;
- focused Catalog contract and disposable-MySQL tests pass.

### Phase 15 — Model-resource and Capability operator experience

Goal: redesign the settings journey only after the corrected state and installation APIs
are stable.

Work:

- separate Installed and Recommended views for both Model Resources and Capabilities;
- make tables prioritize business name, actionable state, execution-source summary, and
  primary action;
- move internal IDs, digests, Adapter identities, revision facts, and advanced mappings
  out of the default view;
- make manual Capability creation one task-focused form with required public contract and
  run-method fields, producing an installed but disabled Capability;
- use focused install, compatible-model selection, run-method management, dependency
  failure, retry, update, enable, disable, and archive dialogs;
- progressively reveal technical configuration only when the current task needs it;
- present Canvas tools by selection context and governed action/category metadata.

Exit criteria:

- the primary tables and dialogs never imply that a recommendation is installed or that
  an enabled Capability is available when its dependency is not;
- a user can create, install, configure, enable, disable, retry, update-review, and archive
  through task-focused flows without seeing unrelated internal facts;
- all changed visible copy is complete in `zh-CN` and `en-US`;
- focused component, route, controller, and accessibility checks pass without an
  intermediate full build or repeated browser pass.

### Phase 16 — Corrected consolidated acceptance

Goal: prove the corrected architecture and representative user journeys once.

Checks:

- generated contracts and generation idempotency;
- relevant and full unit/integration suites;
- architecture, type, format, lint, code-health, complete build, and distribution gates;
- fresh Workspace with visible recommendations and zero installed examples;
- atomic manual Capability creation with one required run method and disabled initial
  enablement;
- recommended model-resource installation and compatible remote-model selection/guidance;
- explicit update review, failure retry, archive, and shared-dependency behavior;
- Workflow independence, direct Agent discovery/invocation, and context-filtered Canvas
  discovery/application;
- one final existing-Chrome acceptance after the complete page state is available.

The final report distinguishes automated proof from local-model inference, paid Provider,
billing, external Storage, or browser evidence that was unavailable.

## 6. Phase 1 audit record

### Current diff ownership

The pre-existing working tree contains 79 modified or deleted tracked paths:

| Group                                                 | Paths | Decision                                                                                    |
| ----------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------- |
| Default Catalog package                               |    41 | Deferred and non-authoritative until Phase 9                                                |
| Generated API artifacts                               |     8 | Coupled to retained source-contract changes; regenerate only after the source set is frozen |
| Explicit migration implementation paths               |     7 | Retain deletion, subject to the invariant checks below                                      |
| Other server, Web, contract, database, and test paths |    23 | Retain as coupled migration removal; no core invariant was weakened                         |

The 41 Catalog paths are quarantined logically: they remain visible in the existing
working tree but must not be used as design input, validated as the final package, or
expanded before Phase 9. They are not reverted destructively because they belong to the
existing user worktree.

### Migration-removal decision

Retain removal of:

- `capability_contract_migration_plan` and its lifecycle triggers;
- the migration Store and Service;
- create, publish, and cancel migration API contracts;
- pending-migration Workflow discovery;
- migration editors, dialogs, actions, and pending-version presentation.

Preserve:

- the `capability_contract_revision` table and immutable lifecycle;
- Definition references to the current Contract and Declaration Revisions;
- Implementation and Binding references to exact Contract Revisions;
- Workflow and Run references to exact Contract Revisions and digests;
- immutable execution plans and historical Attempts;
- the ability to publish replacement Implementations while the public Contract stays
  fixed.

### Evidence collected before this document

- Contracts: 4 targeted files, 17 tests passed.
- Server: 6 targeted files, 25 tests passed.
- Worker: model-resource analysis and Agent Capability execution, 5 tests passed.
- Agent Runtime: Capability ToolView test passed.
- MySQL: CapabilityDefinition store integration test passed.
- MySQL: ModelResource Catalog publication integration test passed.
- MySQL: Browser control-plane integration, 13 tests passed.
- Architecture check passed with dependency, Agent-hardcoding, and consumer-identity
  gates.
- `git diff --check` passed.

No full test suite, complete build, or browser acceptance was run for this audit. That is
intentional under the verification budget.

### Phase 1 final classification

Retained migration-product removal:

- Server module registration, migration Service, capability controller endpoints, and
  their focused tests;
- Web transport calls, migration editor/dialog, pending-version actions and
  presentation, and migration-only locale text;
- source API schemas, routes, exports, and focused contract tests;
- migration-plan table, triggers, schema, Store, runtime exports, Workflow pending
  discovery, migration inventory expectations, and focused database tests;
- Implementation publication against only the Definition's current published Contract,
  rather than a pending migration target.

Retained generated output:

- OpenAPI and Web generated API artifacts that remove only the migration-product
  endpoints and fields. These remain generated output and will be regenerated as one
  batch if a source contract changes in Phases 2–4.

Deferred:

- all 41 modified files under `catalog-packages/kanvas-default`. Their current contents
  are not an accepted default package and are not design input before Phase 9.

Restored:

- none. The audit found no current deletion that removed the immutable Contract,
  Implementation, Binding, execution-plan, Workflow pinning, or historical Run/Attempt
  foundations.

### Phase 1 result

- Status: complete
- Application source changes made during this phase: none; the phase audited and
  classified the pre-existing working-tree changes.
- Plan/document changes: this living plan and audit record were added.
- Verification reused from the unchanged current source: 48 targeted unit tests, 15
  targeted MySQL integration tests, the architecture gate, and `git diff --check`.
- Expensive validation intentionally skipped: full tests, complete build, contract
  regeneration, and browser acceptance.
- Remaining risk: the 41 deferred Catalog edits are still physically present in the
  shared working tree. They are preserved rather than destructively reverted and must
  remain untouched until Phase 9.

## 7. Phase review log

### 2026-09-01 — Plan established

- Result: the delivery sequence and validation budget are frozen.
- Material change: this living plan document was added; no application source changed.
- Validation: documentation checks pending.
- Next: review the completed Phase 1 audit, then begin Phase 2 only after the review.

### 2026-09-01 — Phase 1 complete

- Result: migration-product removal is separated from preserved Revision and execution
  foundations; default Catalog changes are quarantined until Phase 9.
- Material change: no application source changed during the audit.
- Validation: targeted source and MySQL evidence from the unchanged working tree was
  reviewed; final documentation checks are recorded with the phase handoff.
- Deviation: the deferred Catalog diff remains visible because removing existing user
  worktree changes would be destructive and is unnecessary for the architecture audit.
- Next: Phase 2 proves model-resource ingestion and publication without installing or
  consulting the default Catalog.

### 2026-09-01 — Commit policy updated

- Result: the user authorized necessary commits during subsequent implementation.
- Rule: prefer one scoped commit at a proven phase boundary; avoid intermediate commit
  noise and do not push without a separate instruction.

### 2026-09-01 — Phase 2 complete

- Result: direct upload and stable HTTPS model-resource flows no longer depend on a
  default Catalog entry for analysis or publication.
- Root cause fixed: non-Catalog analysis reports format-compatible Adapters as
  `probable`, while publication previously admitted only `exact` analysis matches. A
  directly imported resource therefore published with no execution target and could not
  be selected by a Browser or Worker implementation.
- Implementation: publication now derives current execution targets from the
  administrator-confirmed format and the current published Runtime Adapter definitions.
  Provider-only and model-service-only Adapters remain excluded.
- Tests added: stable HTTPS import start without Catalog lookup, governed HTTPS download
  handoff, direct upload analysis against data-defined Adapters, direct publication
  without Catalog storage identities in the response, and disposable-MySQL publication
  with zero Catalog entries.
- Validation: 6 focused Server tests, 9 focused Worker model-import tests, 15 focused
  Storage tests, one disposable-MySQL direct-publication test, Server/Worker/Database
  package type checks, formatting, and `git diff --check` passed.
- Expensive validation intentionally skipped: full tests, complete build, contract
  regeneration, real S3, local model execution, and browser acceptance.
- External boundary: Local/S3 parity is proven at the StoragePort and mocked S3 adapter
  boundary. A real external S3 endpoint was not configured or contacted.
- Commit: not created. The shared working tree still contains the pre-existing Phase 1
  and deferred Catalog changes, so a Phase 2-only commit would not represent a clean
  repository milestone. Commit authorization remains available for a later scoped
  boundary.
- Next: Phase 3 audits fixed model-operation assumptions and keeps Capability-core code
  independent of Provider- and Adapter-specific behavior.

### 2026-09-01 — Phase 3 complete

- Result: Capability administration consumes the controlled Provider operation contract
  as data and no longer special-cases image operations.
- Root cause fixed: Provider Route administration projected `modelOperation` only for
  `image.generate` or `image.edit` routes with parameter policies. A valid
  `text.generate` Route was therefore invisible to a matching Runtime Adapter and could
  not become a Capability run method.
- Provider contract: the existing controlled Provider operation set now has one shared
  runtime type guard and the HTTP schema consistently includes `text.generate`. The
  phase did not open arbitrary operation strings.
- Runtime Adapter matching: operation, API surface, and optional Provider preset are now
  carried through the administration API and checked consistently by both the Web
  editor and Server publication gate.
- Model-profile projection: parameter metadata remains optional. V2 and V3 profiles are
  parsed only when a Route actually carries parameter policies; the operation identity
  remains available independently.
- Architecture gate: the Capability Implementation service, Capability Binding admin
  store, and Capability implementation editor may not enumerate concrete Provider
  operation literals.
- Tests added or extended: controlled text-operation projection, unsupported-operation
  exclusion, text model-service publication, and Provider-preset Adapter filtering.
- Validation: 12 focused Contract tests, 2 focused Database tests, 5 focused Server
  tests, 5 focused Web tests, one disposable-MySQL Provider Settings integration test,
  affected-package type checks, one batched contract generation, the architecture gate,
  formatting, and `git diff --check` passed.
- Tooling note: the first root generation attempt resolved the user-global pnpm 9.4.0
  and stopped before generation. The same package generation was rerun successfully with
  the repository's fixed Corepack pnpm 11.17.0 and `/opt/homebrew/bin` PATH.
- Expensive validation intentionally skipped: full tests, complete build, a second
  generation/idempotency pass, Provider execution, billing settlement, and browser
  acceptance.
- Commit: not created. Generated artifacts currently combine the pre-existing Phase 1
  migration removal with Phase 3 schema changes; committing only part of that generated
  state would be misleading. The next planned clean milestone is the Phase 4
  control-plane freeze.
- Next: Phase 4 closes Definition, Declaration, Contract, Implementation, Binding,
  mapping, fixture, replacement, and execution-plan semantics before the first planned
  full repository gate.

### 2026-09-01 — Phase 4 complete

- Result: the Capability core control plane is frozen for the first vertical slice.
  Definition, Declaration, Contract, Implementation, Binding, mapping, fixture,
  availability, ordering, replacement, idempotency, and execution-plan identities are
  covered without a default Catalog dependency.
- Source admission: the database Schema, initial SQL baseline, runtime projection, and
  HTTP contract now admit only the three executable V1 Implementation sources:
  `model_resource`, `model_service`, and `plugin`. The unimplemented `workflow`, `api`,
  and `mcp` source kinds can no longer enter through a lower-level or direct database
  path.
- Empty control-plane evidence: a new disposable-MySQL test creates one Capability,
  proves it is absent from Agent and Workflow discovery while unbound, publishes two
  plugin-backed run methods, reorders them, pauses and restores one, replaces the other
  with a new immutable Implementation Revision, and replays the publication without
  duplicating facts.
- Revision outcome: replacement preserves the Binding identity, deprecates rather than
  deletes the old Implementation Revision, and keeps the Definition's Contract Revision
  unchanged.
- Static validation: repository formatting, affected and repository type checks, full
  ESLint and Stylelint, 17 code-health checks, maintainer-language and documentation
  gates, the architecture gate, generated contracts, and `git diff --check` passed.
- Database validation: the new Capability-core integration and the existing Definition
  lifecycle integration passed against disposable MySQL.
- Planned full gate: the complete build passed 14/14 packages. The full test run passed
  every completed package but initially reported seven Worker failures from two files
  because the sandbox denied local `127.0.0.1` listeners. Those exact two files passed
  14/14 tests in the authorized environment. Turbo interrupted the Web task after the
  Worker failure, so the Web package alone was resumed and passed 182 files / 844 tests.
  No other package suite was repeated.
- Browser validation intentionally skipped: Phase 4 changes lower-level contracts and
  the first browser gate remains reserved for Phase 7.
- Commit: `d7abc17 feat(capabilities): freeze resource and capability control planes`.
  All 41 deferred default Catalog paths remained unstaged and no remote was updated.
- Next: Phase 5 proves one representative Capability from an empty Workspace through
  immutable runtime facts without installing the default Catalog or running a local
  model.

### 2026-09-01 — Phase 5 complete

- Result: the existing disposable-MySQL Worker image round trip now seeds the complete
  current control-plane chain in a new Workspace: Definition, Declaration, Contract
  Revision, Runtime Adapter Definition/Revision, plugin-backed Implementation Revision,
  Binding, immutable execution-plan snapshot, Run, and Attempt.
- Runtime proof: a deterministic image Adapter reads a committed source Artifact,
  produces a different verified PNG, materializes it through Local Storage, and reaches
  atomic completion with the expected `CapabilityRun`, accepted `CapabilityAttempt`,
  committed upload, `StoredObject`, and `Artifact` facts. The same test also proves that
  an output produced after lease loss cannot complete and is reclaimed without leaving
  terminal database facts.
- Pinned identity: execution receives the exact published Runtime Adapter Revision and
  digest recorded by the fixture. The generic Worker registry rejects missing or
  mismatched pinned Adapter identity; no Capability-key or field-name branch was added.
- Empty-workspace boundary: no default Catalog package is installed or read. The model
  resource part of the slice reuses the unchanged Phase 2 disposable-MySQL evidence for
  direct publication with zero Catalog entries; it was not rerun because Phase 5 did
  not change that path. Actual inference uses the deterministic test Adapter, not a
  local model.
- Files changed: `apps/worker/test/worker-trusted-image-round-trip.integration.test.ts`
  and this plan document. The 41 deferred default Catalog paths remain untouched.
- Validation: Worker package type check, lint of the changed integration test, and the
  single disposable-MySQL plus Local Storage image round-trip integration test passed.
  Documentation checks, formatting, and `git diff --check` are the closing checks for
  this phase.
- Expensive validation intentionally skipped: full tests, complete build, contract
  generation, browser acceptance, Provider execution, real S3, and local model
  execution. The Phase 4 full gate remains valid because production code and shared
  contracts did not change.
- Deviation repaired: the pre-existing integration fixture still inserted the older
  partial Implementation shape and did not supply the now-required pinned Runtime
  Adapter identity. The fixture was brought forward to the frozen control-plane
  contract; no production compatibility path was introduced.
- Commit: `92dfe6f test(capabilities): prove empty-workspace image round trip`.
  The deferred default Catalog paths remained unstaged and no remote was updated.
- Next: Phase 6 proves that Workflow, Agent, and Canvas consume this same published
  Capability authority without persisting lower-level model, Adapter, or routing
  identities.

### 2026-09-01 — Phase 6 complete

- Result: Workflow, Agent, and Canvas now admit capabilities from the same active
  Definition, exact Contract Revision, current published Declaration, and available
  Binding authority. Consumer discovery no longer treats `supportedInvokers` alone as
  sufficient when the Declaration excludes that Surface.
- Workflow: authoring discovery continues to return the exact Contract key, revision,
  digest, public Schemas, and semantic Declaration. The existing publication and
  execution-plan paths remain revision-pinned; no lower-level identity was added.
- Agent: catalog search now enforces the `agent` Declaration Surface in the database,
  while `capability.invoke` still re-resolves discovery, requires an enabled canonical
  Workflow entrypoint, and validates input against the published public Schema before
  preparing a reviewable invocation. A supplied undiscovered key or lower-level field
  cannot bypass those checks.
- Canvas: enabled Skill/Workflow entrypoints receive a narrow Capability projection
  containing only the public Contract key/revision/digest, Surfaces, and semantic
  parameter/output ports. Canvas tools require the `canvas` Surface, an Artifact input,
  and the declared primary Artifact output; the public Capability key owns operation
  identity, so a Skill-provided internal operation ID cannot override it. Display name
  and category come from the current Declaration.
- Canvas application: the existing reauthorization and editor reducer path remains the
  authority for applying the primary Artifact. Its focused test proves replacement is
  one undoable history entry; this phase did not introduce another application path.
- Replacement proof: a new disposable-MySQL test manually publishes one image
  Capability, one plugin run method, one exact Workflow Revision, and one enabled Skill
  entrypoint without installing the default Catalog. The same public identity appears
  in all three consumers, contains no Implementation, Binding, Adapter, model, or
  Storage identity, and remains unchanged after switching the Binding to a different
  Implementation and Runtime Adapter.
- Surface proof: the same test publishes a bound Canvas-only Capability whose Contract
  still lists Workflow and Agent invokers; Workflow and Agent discovery both exclude
  it because its Declaration does not authorize those Surfaces.
- Validation: 10 Contract tests, 9 Database projection tests, 8 Server controller tests,
  3 Worker Agent-catalog tests, 28 focused Canvas tests, one disposable-MySQL
  three-consumer integration test, affected-package type checks, batched contract
  generation, and the closing architecture/format/lint/document/diff checks passed.
- Verification budget: full tests, complete build, browser acceptance, Provider
  execution, and local model execution were intentionally skipped. The first browser
  gate remains Phase 7, after the operator journey is complete.
- Scope: no default Catalog file was modified or staged. The projection was deliberately
  narrowed after its first generated form so Canvas receives only the business facts it
  consumes rather than a duplicate full Capability document.
- Commit: `6ed27b6 feat(capabilities): unify consumer discovery authority`. The
  deferred default Catalog paths remained unstaged and no remote was updated.
- Next: Phase 7 exposes the already-proven control plane as one operator-facing journey
  and performs the first existing-Chrome acceptance only after the complete page state
  is ready.

### 2026-09-01 — Phase 7 complete

- Result: the settings journey now separates installed Model Resources from optional
  recommendations, keeps the existing source-analysis-publication flow behind the
  installed-resource task, and presents only current Workspace Capability facts with
  one availability state per row.
- Locale input: Capability metadata, public field labels, and run-method metadata use
  the active interface locale. The editor mirrors a value only while the other locale
  is empty, so a previously authored translation is preserved without requiring every
  operator to enter both languages.
- Run-method mapping: the operator editor now accepts a Runtime Adapter Artifact
  reference as the source of a public Artifact-ID string. This is the same general
  compatibility rule already enforced by the mapping compiler; no Capability key,
  Adapter key, or plugin name is hard-coded.
- Existing-Chrome acceptance: in the authenticated local Workspace, the installed
  Model Resource view truthfully began empty and recommendations remained in their own
  view. A new `image.phase-seven.denoise` Capability was created from public business
  metadata, connected to the data-discovered browser plugin, mapped, tested, and
  published. Its row changed from `unconfigured / needs attention` to `local execution
/ in use`. A separate unconfigured Capability continued to show the attention state,
  proving that the two statuses were not collapsed or contradicted.
- Browser boundary: this was the single planned Phase 7 browser gate and reused the
  existing Chrome plugin session. The current development database was not reset, so
  the representative journey began with a new target Capability rather than claiming a
  wholly fresh Workspace. The final fresh-Workspace and explicit-Catalog-install proof
  remains reserved for Phase 10.
- Console evidence: no application warning or error occurred during the accepted flow;
  the only console entry was Ant Design's existing Notification `message` deprecation
  warning.
- Verification budget: use focused editor tests, the affected Web type check, scoped
  lint/format checks, locale-key parity, architecture/document checks, and diff gates.
  Do not run the full test suite, complete build, Provider execution, or local model
  execution for this UI phase.
- Scope: the 41 deferred default Catalog paths remain outside this phase and must not be
  staged. No remote update is authorized.
- Commit: `898c760 feat(settings): complete capability operator journey`. The
  deferred default Catalog paths remained unstaged and no remote was updated.
- Next: Phase 8 records the post-release Contract-evolution boundary without adding a
  migration product, compatibility runtime, or speculative UI.

### 2026-09-01 — Phase 8 complete

- Result: the architecture now describes the post-release Contract-evolution boundary
  as a future requirement instead of an implemented first-release migration product.
- Implemented distinction: editing localized discovery metadata publishes another
  immutable Declaration Revision against the current Contract. Replacing or adding a
  run method publishes another Implementation Revision and explicitly updates or adds
  its Binding under that same Contract.
- Deferred distinction: an additive Contract change is only a compatibility candidate;
  a breaking change requires an explicit future evolution protocol. Neither case is
  currently publishable through a Contract-update API or Settings flow.
- Trigger: the future protocol begins only when a post-release executable input/output
  change is required while an existing published Workflow, surface entrypoint,
  Binding, or historical Run references the current Contract Revision. That future
  design must cover impact preview, mappings where meaningful, new Workflow Revisions,
  ready run methods and entrypoints, atomic discovery switching, and safe cancellation.
- Historical authority: published Workflow content pins Contract key, Revision, and
  digest; WorkflowRun pins its Workflow Revision; ExecutionPlanSnapshot pins the exact
  Contract and route candidates. Later administration does not rewrite those facts.
- Documentation: `CAPABILITY-CONTROL-PLANE-V1.md` and `CAPABILITIES.md` no longer claim
  migration-plan, impact-preview, dual-read, or upgrade-UI behavior exists. The
  declaration document now reflects persisted declared Revisions and the removal of
  the old inferred compatibility projection.
- Scope: no application code, schema, migration, API, UI, dual-read behavior, or
  compatibility runtime was added. The 41 deferred default Catalog paths remain
  unstaged and were not used as design input.
- Verification budget: run formatting, maintained-document checks, targeted stale-claim
  searches, and diff gates only. Full tests, type checks, builds, and browser acceptance
  are unnecessary for this documentation-only phase.
- Commit: `a79e02b docs(capabilities): define contract evolution boundary`. The
  deferred default Catalog paths remained unstaged and no remote was updated.
- Next: Phase 9 rebuilds the optional default Catalog from the now-frozen manual
  definitions and consumer contracts.

### 2026-09-01 — Phase 9 complete

- Result: the quarantined default Catalog is now reviewed against the final
  ModelResource, RuntimeAdapter, Contract, Declaration, Implementation, Binding,
  Workflow, and Skill formats instead of serving as earlier-phase design input.
- First-release identity: `image.background.remove`, `image.crop.suggest`,
  `image.edit`, and `image.generate` had no accepted earlier public Revision, so their
  isolated Revision 2 identities were normalized to Revision 1. The exact Contract
  digests then propagated through their Declarations, ten Implementations, ten
  Bindings, six Workflows, six Skills, the asset descriptors, and the package digest.
- Reviewed examples: the package remains 148 assets: 14 Capability Contracts and
  Declarations, 27 Runtime Adapters, 27 Implementations, 27 Bindings, three optional
  Model Resource recommendations, 18 Workflows, and 18 Skills. No speculative example
  or second Catalog mechanism was added.
- Product-entrypoint proof: every declared Capability has at least one published run
  method and is required by a Skill-backed Workflow; every packaged Workflow is
  referenced by a Skill entrypoint. The test also requires every first-release
  Capability Contract to remain Revision 1.
- Pinning and ordering: the existing generic loader verifies every asset and package
  digest and returns deterministic dependency order. The existing preparer verifies
  exact Contract, Adapter, ModelResource, Implementation, Binding, Workflow, and Skill
  Revision/digest references and compiles all mappings and fixtures.
- Empty bootstrap: the disposable first-administrator redemption test now proves that
  normal instance initialization creates the administrator, organization, Workspace,
  and owner memberships while leaving Capability Definitions, model recommendations,
  Workflow Revisions, and Skill Revisions empty.
- Explicit and idempotent installation: the disposable demo bootstrap runs the
  separate Catalog installer twice and still produces exactly 14 Definitions, 27
  Implementations, 27 Bindings, 27 Runtime Adapters, three recommendations, zero
  published model resources, 18 Workflows, and 18 Skills. Catalog-dependent integration
  tests invoke the installer explicitly; normal bootstrap has no default-data side
  effect.
- Consumer proof: after explicitly installing the package and publishing the reviewed
  IS-Net recommendation through the normal resource path, Agent discovery and the
  Canvas creation-entrypoint projection both expose `image.background.remove`. Canvas
  is located by the public Capability key and uses the current Declaration title, not
  a stale Skill display-name assumption.
- Verification budget: use focused Catalog contract/loader/installer/mapping tests,
  affected package type checks, scoped lint/format checks, three disposable-MySQL
  integration files, document/architecture/diff gates, and generated-contract checks.
  Full suites, complete build, browser acceptance, Provider execution, and local model
  execution remain reserved or unnecessary here.
- Scope: the 41 previously deferred Catalog files are now Phase 9 work and may be
  staged together with the four directly related proof-test files and this plan. No
  remote update is authorized.
- Commit: `5e50fa7 feat(catalog): rebuild first-release defaults`. The
  previously quarantined Catalog paths are now reviewed, committed, and no longer
  present as working-tree residue. No remote was updated.
- Next: Phase 10 performs the consolidated full repository and fresh-Workspace
  acceptance, including the second and final existing-Chrome gate.

### 2026-09-01 — Phase 10 complete

- Result: the lower-level control plane, operator journey, three consumers, optional
  Catalog, and fresh-Workspace behavior have one consolidated automated and browser
  acceptance record. No compatibility layer, migration product, or hard-coded
  Capability/Adapter selection was reintroduced.
- Closing repair: the first full code-health run found nine complex localized-field
  handlers left inline by Phase 7. They were moved into named component handlers with
  no behavior change or baseline exception. The fresh-Workspace browser pass also
  clarified the Capability Definition lifecycle label from `in use / Active` to
  `Enabled`, leaving run-method availability as the separate execution truth.
- Repository verification: contract generation and generated-output idempotency,
  formatting, all package type checks, code and style lint, code-health policies,
  architecture gates, complete package tests, five development-command tests, all 14
  package builds, and dist-only entry/import verification passed. The sandboxed Worker
  run failed only because seven HTTP/health tests could not bind loopback; the complete
  Worker suite then passed in the authorized environment with 60 files / 314 tests,
  and the interrupted Web suite passed separately with 182 files / 847 tests.
- Database verification: the full disposable-MySQL inventory passed 31 files / 85
  tests, including empty instance bootstrap, explicit/idempotent Catalog installation,
  model-resource publication, Capability run-method creation/replacement/fallback,
  revision pinning, Agent and Canvas projections, execution, cancellation, recovery,
  storage, and audit behavior.
- Browser environment: the second and final browser gate reused the existing Chrome
  plugin session and an isolated local Workspace named `Phase 10 Acceptance`. The
  repository has no ordinary post-setup Workspace-creation route, so the Workspace and
  owner membership were seeded directly from the already authenticated administrator;
  normal first-administrator creation remained covered by disposable MySQL rather than
  being misrepresented as browser proof.
- Empty browser state: before Catalog installation, the isolated Workspace showed zero
  installed Model Resources, zero model recommendations, and zero Capabilities.
- Explicit Catalog browser state: the separate Catalog installer added the reviewed
  package digest and 148 assets. The Capability page then showed exactly 14 rows, with
  deterministic/plugin routes available and unresolved Provider/model dependencies
  truthfully marked `not configured / needs attention` while their Definitions remained
  `Enabled`.
- Real model-resource journey: the browser selected the 3.9 MB Tesseract recommendation,
  downloaded it from the pinned HTTPS source, analyzed its format/license/compatible
  Adapter, and published it. Recommendations changed from three to two, installed
  resources changed from zero to one with one Implementation reference, and
  `image.text.extract` changed from unavailable to `worker` execution.
- Consumer browser evidence: Workflow templates exposed `Text extraction` after model
  publication, and Agent's extension picker exposed nine currently available
  Skill-backed entries including `Text extraction`. No Agent model invocation was sent
  because the fresh Workspace had no configured text model.
- Browser limitation: Chrome accepted navigation and authenticated mutations but
  rejected local file assignment through its file chooser with `Not allowed`.
  Therefore no Canvas browser execution or undo/redo claim is made; those paths are
  covered by the complete Web/Worker tests and disposable-MySQL consumer authority
  tests. The console contained no application failure; the only entry was Ant Design's
  existing Notification `message` deprecation warning.
- External boundary: no local model was executed. External S3 behavior, paid Provider
  execution, real billing settlement, multi-node failure, and production deployment
  remain outside this local acceptance and must not be inferred from these results.
- Local residue: the identifiable `Phase 10 Acceptance` Workspace and its published
  Tesseract resource remain in the local development database as acceptance evidence;
  they were not destructively removed.
- Delivery: create one final scoped commit for the code-health repair, lifecycle copy,
  and this completed review. Do not push without explicit user instruction.

### 2026-09-01 — Phase 11 complete

- Result: the plan now treats Workflow, Agent Skill, and Canvas as independent
  Capability consumers and separates Catalog recommendation, Workspace installation,
  enablement, and runtime availability.
- Corrected drift: the Phase 6 Agent single-node Workflow requirement, Canvas
  Skill/Workflow discovery dependency, and Phase 9 mandatory Workflow/Skill Catalog
  coverage are retained only as historical evidence and are explicitly superseded.
- Frozen product rules: manual Capability creation requires one complete run method and
  commits atomically as installed but disabled; recommended installation activates one
  confirmed default route only after dependencies are ready; updates are explicit; and
  shared dependencies are not cascade-deleted.
- Delivery sequence: Phase 12 corrects the lower-level installation facts, Phase 13
  decouples consumers, Phase 14 rebuilds official recommendations, Phase 15 redesigns
  the operator UI, and Phase 16 performs one consolidated full and browser acceptance.
- Material change: only this plan document changed; no application source, schema,
  generated contract, Catalog package, local database, or browser state changed.
- Validation: `pnpm docs:check` passed for 72 maintained Markdown files and 51
  English-first maintainer documents; `git diff --check` passed.
- Expensive validation intentionally skipped: unit/integration suites, type checks,
  generation, complete build, and browser acceptance cannot add evidence to a
  documentation-only phase.
- Commit: intentionally deferred; the single living-plan change remains isolated and
  can join the first material Phase 12 milestone. No remote update was made.
- Remaining risk: the current runtime and Catalog still implement the superseded path;
  this is the explicit scope of Phases 12–14, not evidence that the correction is done.
- Next: begin Phase 12 with a read-only schema/store/API audit, then implement the
  smallest complete installation-state slice before any settings-page redesign.

### 2026-09-01 — Phase 12 foundation checkpoint

- Result so far: Catalog Capability recommendations and recoverable installation
  operations are independent from Workspace Capability facts. A recommendation snapshot
  is restricted to one Contract, one Declaration, one Runtime Adapter, one
  Implementation, one enabled default Binding, an optional model resource, and no
  Workflow or Skill.
- Manual creation: the public create request now requires its first run method. Contract,
  Declaration, Implementation, and a disabled Binding commit in one MySQL transaction;
  a run-method failure rolls back the Definition as well. The existing page was changed
  only enough to collect both parts before one submission; visual redesign remains in
  Phase 15.
- Recommended installation: an explicit confirmed request pins the Catalog digest,
  installs only the selected default route, accepts only a compatible ready remote-model
  route, starts and attaches the declared model-resource import when bytes are absent,
  and records failed/waiting/installed operations without creating Workflow or Skill
  facts.
- State truth: enabled Binding state remains separate from derived dependency
  availability. Archiving a shared model resource keeps both the resource record and the
  enabled Binding while discovery reports the route unavailable. A newer Catalog entry
  is reported as an available update and cannot replace the installed revision through
  the install command.
- Private executors: Capability-private Runtime Adapters are excluded from the manual
  run-method directory and rejected by the manual publication service. Catalog install
  additionally requires a private built-in executor to name its owning Capability.
- Validation so far: four affected-package type checks passed; 3 Contract files / 9
  tests, 4 Server files / 11 tests, 1 Database unit file / 2 tests, and 2 Web files / 3
  tests passed; the two focused disposable-MySQL files passed 3 tests. Focused ESLint and
  `git diff --check` passed.
- Verification budget: no full suite, complete build, or browser acceptance was run.
  One affected dependency build was used only to run the disposable-MySQL files.
- Remaining before Phase 12 can close: carry the original authorized installation
  operation through the Worker after trusted Catalog model analysis, so publication and
  Capability activation complete without a second foreground/user request. This must not
  fabricate a browser session or bypass permission/audit facts.
- Commit: deferred until this asynchronous continuation is complete and the Phase 12
  exit criteria pass. No remote update was made.

### 2026-09-01 — Phase 12 complete

- Result: Capability recommendation metadata, installation operations, installed
  Workspace facts, enablement, and derived runtime availability are now separate. The
  public directory can expose recommendations without materializing Capability records.
- Manual creation: the create contract requires one complete run method. Definition,
  Contract, Declaration, Implementation, and its initially disabled Binding commit in
  one transaction; an invalid Adapter or run method rolls back the entire Capability.
- Recommended route: one confirmed Catalog digest snapshots exactly one default Binding
  and its lower dependency. Plugin routes install immediately; model-service routes
  accept only an explicitly selected compatible ready model; model-resource routes wait
  without creating Capability facts.
- Automatic model dependency: the install service starts and attaches the declared
  Catalog model import. The maintenance Worker leases ready continuations, rebuilds the
  exact original database-issued Workspace Scope, reauthorizes the membership or Service
  Grant, publishes the verified resource, and resumes the same idempotent Capability
  install. Lease expiry and published/imported fact checks recover process interruption
  without a browser or second user request.
- Authorization boundary: installation operations persist the original principal,
  authentication reference, reference hash, authority identity/version, authorization
  model, and effective permissions. Worker continuation never invents a Session; stale
  or revoked authority fails the operation and is audited.
- Dependency ownership: installed Model Resources remain Workspace-owned and shared.
  Archiving a resource preserves it and the enabled Binding while availability becomes
  unavailable. Capability install/archival code does not cascade-delete shared bytes.
- Update boundary: registering a newer recommendation retires only the older Catalog
  entry, reports an update, and cannot replace the installed revision through the install
  command. No automatic upgrade path was added.
- Private executor boundary: Capability-private Runtime Adapters are hidden and rejected
  by manual run-method publication. A private built-in Catalog executor must declare the
  exact owning Capability.
- Side-effect boundary: focused MySQL proof confirms that installing one recommended
  route writes no Workflow Definition or Skill Revision.
- Validation: Contracts, Database, Server, Worker, and Web type checks passed. Focused
  unit/component coverage passed 12 files / 29 tests; focused disposable-MySQL coverage
  passed 2 files / 3 tests, including automatic model publication, atomic creation,
  rollback, update refusal, shared-resource archive, and zero Workflow/Skill side
  effects. Focused ESLint, repository code-health, documentation checks, architecture
  gates, and `git diff --check` passed. The affected
  Contracts/Application/Database dependency build passed solely to run the
  disposable-MySQL harness.
- Verification budget: no full test inventory, complete repository build, browser
  acceptance, Provider invocation, external Storage, or local model execution was run.
- Remaining boundary: the current official default package still follows the superseded
  bulk installer and has not yet registered these recommendations. Phase 14 owns that
  rebuild after Phase 13 removes the Workflow/Skill consumer coupling. Remote-model
  compatibility is contract/store tested but no paid Provider call is inferred.
- Delivery: one scoped local Phase 12 commit includes the Phase 11 plan correction and
  this completed implementation. No remote update was made.
- Next: Phase 13 removes Agent's synthetic single-node Workflow requirement and Canvas's
  Skill/Workflow entrypoint dependency while preserving the governed CapabilityRun,
  authorization, budget, audit, Artifact, and undo boundaries.

### 2026-09-02 — Phase 13 complete

- Result: Workflow, Agent, and Canvas now share the governed Capability Contract and
  execution kernel without sharing a product entrypoint. A Capability Run records its
  immutable invocation kind, caller reference, actor, input, pinned route, and deadline;
  only Workflow-owned runs require a Node Run parent.
- Agent boundary: Capability discovery no longer looks for a synthetic single-node
  Workflow. Confirming a reviewed Capability proposal creates a direct Agent-owned
  Capability Run, while an independently proposed Workflow still creates a Workflow Run
  and requires its own permission. Agent Skills were neither generated nor rewritten.
- Canvas boundary: the editor queries enabled and currently available Capabilities by
  `canvas` surface, action group, selected semantic type, permission, and declared source
  policy. Tool placement, interaction, completion, output modes, and ordering come from
  the Capability Declaration; no Capability key selects behavior. Canvas starts, polls,
  cancels, reviews, applies, and undoes a direct Capability Run.
- Removed coupling: the obsolete Canvas Skill/Workflow entrypoint adapter and its
  hard-coded quality-assessment path were deleted. The remaining creation-entrypoint API
  is retained for Agent references to independently authored Workflow and Skill content,
  not for Canvas Capability discovery.
- Runtime governance: direct Agent and Canvas calls use the same Binding availability,
  target gate, Provider route, budget, retry, lease, cancellation, reconciliation,
  completion, Artifact lineage, audit, and immutable execution snapshot boundaries as
  Workflow calls. Direct terminal events remain durable but do not enter Workflow
  orchestration.
- Independence proof: disposable MySQL creates one manually authored Capability with no
  Workflow Revision or Skill Revision, discovers it through all three consumers, runs it
  directly from Canvas through Worker claim and atomic completion, and confirms that a
  lower implementation replacement does not change the public consumer identity.
- Validation: Contracts, Database, Server, Worker, and Web type checks passed. Focused
  suites passed 2 Contract files / 7 tests, 2 Server files / 16 tests, 3 Worker files / 56
  tests, 6 Web files / 58 tests, and 1 Database unit file / 2 tests. The focused
  disposable-MySQL batch passed 4 files / 25 tests; after moving Canvas semantic matching
  fully into SQL, the direct-consumer file passed again with 1 test. Changed TypeScript
  and TSX files passed focused ESLint. Changed-file formatting, documentation checks,
  repository code-health policies, architecture gates, and `git diff --check` passed.
- Verification budget: no full suite, complete repository build, browser acceptance,
  Provider invocation, external Storage, or local model execution was run. Phase 16
  remains the single planned full and existing-Chrome acceptance gate.
- Remaining boundary: the official default package still contains the superseded example
  set and bulk-install assumptions. Phase 14 must rebuild it as visible but uninstalled
  recommendations using the now-proven independent consumer contract; Phase 15 then owns
  the Model Resource and Capability management-page redesign.
- Delivery: create one scoped local Phase 13 commit. No remote update is authorized.
- Next: begin Phase 14 with a read-only inventory of the current Catalog entries and keep
  only recommendations backed by a real atomic Capability use case.

### 2026-09-02 — Phase 14 complete

- Result: the official package is now `2.0.0` and represents recommendations, not a
  preinstalled Workspace. It declares 14 atomic Capability recommendations, each with
  exactly one enabled default Binding, and contains only their 73 transitive assets: 14
  Contracts, 14 Declarations, 14 Runtime Adapters, 14 Implementations, 14 Bindings, and
  3 Model Resource recommendations.
- Removed package coupling: all 18 Workflow and 18 Skill descriptors, plus every unused
  alternative run method, were removed from the recommendation manifest. Their dormant
  source documents remain outside the manifest and are neither loaded nor registered;
  Capability installation still creates no Workflow or Skill fact.
- Bootstrap semantics: normal server and development initialization load and validate
  the official package, then register its recommendation snapshots atomically with the
  first Workspace. `bootstrap:demo` and `bootstrap:catalog` now register recommendations
  only; neither command invokes the bulk materializing installer.
- Empty-state proof: initial registration creates 14 Capability Catalog entries and 3
  Model Resource Catalog entries while Capability Definition, Runtime Adapter,
  Model Resource, Workflow Revision, and Skill Revision counts remain zero. Repeating
  registration is idempotent.
- Install boundary: selecting one recommendation still delegates to the Phase 12
  installation operation, snapshots only that recommendation's Contract, Declaration,
  Adapter, Implementation, Binding, and optional Model Resource, and installs exactly
  one route. A newer registered package can report an update but cannot upgrade an
  installed Workspace fact automatically.
- Model-service defaults: image generation and general image editing use the reviewed
  `generation.tasks.v1` operation/modality route so compatible configured models can be
  selected; recommendations without a compatible ready model retain the existing
  Model Service configuration guidance. No Provider call was made.
- Built-in algorithm boundary: every recommended built-in plugin Adapter is explicitly
  `capability_private` and names its owning Capability, so it is visible as part of that
  recommendation but cannot appear in another manually authored Capability's run-method
  directory.
- Canvas definition alignment: all Contracts whose Declarations expose the Canvas
  surface now include the `canvas` invoker. Six current image-editing tools declare
  `image.edit`, `canvas_selection`, interaction/review behavior, output modes, and order;
  their category is consistently `Image processing`. Optional secondary Artifact inputs
  are not exposed as raw text fields.
- Runtime correction: MySQL produced incorrect empty results when parameterized JSON
  predicates and the correlated availability aggregate were combined in one filter. The
  Canvas directory now reads the contract-bounded Canvas surface set and applies action,
  semantic, and availability filtering from the same governed Declaration and shared
  availability projection, without Capability-key conditions.
- Validation: Contracts, Database, Server, and Web type checks passed. Focused suites
  passed 2 Contract files / 4 tests, 3 Database unit files / 11 tests, and 1 Web file / 2
  tests. Focused disposable-MySQL coverage passed 5 files / 6 tests for fresh bootstrap,
  recommendation idempotency, one-route install, model-resource activation, Provider
  route compatibility, and independent direct consumers. Changed TypeScript and TSX
  files passed focused ESLint. Changed-file formatting, documentation checks,
  repository code-health policies, architecture gates, Catalog digest verification, and
  `git diff --check` passed.
- Verification budget: no full suite, complete repository build, browser acceptance,
  paid Provider invocation, external Storage, or local model execution was run. Phase 16
  remains the single planned full and existing-Chrome acceptance gate.
- Existing data boundary: already installed examples are preserved and are not silently
  migrated, disabled, or deleted. Existing Workspaces receive the new recommendations
  only through the explicit idempotent Catalog registration command; a genuinely fresh
  Workspace receives them during setup.
- Delivery: create one scoped local Phase 14 commit. No remote update is authorized.
- Next: Phase 15 redesigns the Model Resource and Capability tables, dialogs, and forms
  around Installed versus Recommended state and the user's next actionable step.

### 2026-09-02 — Phase 15 step 1 complete: Capability directory and recommended install

- The Capability page now defaults to an Installed view with a direct empty-state action
  to open Recommended. Installed and Recommended counts and search share one directory.
- The primary table is reduced to business name and purpose, category, actionable state,
  and the next action. Capability keys, public-contract counts, consumer surfaces, route
  identities, execution targets, and dependency details are no longer shown by default.
- Installed state is presented as Ready, Needs setup, or Archived. Recommendations remain
  visibly Not installed, Installing, or Install failed until a Workspace Capability fact
  exists; an installing recommendation is refreshed without a full-page reload.
- Installation asks for lower-level information only when the user must act. Catalog model
  resources are added automatically after confirmation, compatible configured models are
  selected by their user-facing model and service names, missing compatible models lead to
  Model services, and built-in processing installs directly.
- Adding a custom Capability is retained as a secondary action rather than the page's main
  call to action. The existing technical details, manual authoring form, and run-method
  management remain unchanged in this step and are explicit Phase 15 follow-up scope.
- Focused validation: Web type checking passed; the changed TypeScript and TSX files passed
  ESLint; the Web transport suite passed 42 tests including the recommendation-install
  request contract; changed files passed Prettier and `git diff --check`.
- Verification budget: no full suite, complete build, or browser authentication was run.
  Browser acceptance remains deferred until the complete Phase 15 page state is available.
- Next: simplify the Model Resource directory and its add/recommendation flow using the same
  non-technical information hierarchy, then return to Capability details and manual creation.

### 2026-09-02 — Phase 15 step 2 complete: Model directory and add flow

- The Model Resource page now defaults to Added, counts Added and Recommended separately,
  and gives an empty Workspace a direct action to browse recommendations.
- The primary table shows only the model's user-facing name and purpose, actionable state,
  and available operation. Keys, formats, byte sizes, execution locations, revisions, and
  implementation-reference counts are removed from the default view.
- Recommended models are explicitly Not added. Selecting Add confirms the user-facing model
  and relevant download size once; the existing trusted import analysis then completes the
  publication automatically without presenting format, source-host, Runtime Adapter, or
  publication-key details.
- Adding a custom model remains a secondary action. Its existing URL/upload trust boundary is
  preserved, while the review asks for only name and description plus format or license when
  analysis explicitly reports that user input is required. An internal key is generated when
  analysis cannot suggest one.
- Focused validation: Web type checking passed; the changed route, editor, and test files passed
  ESLint; the Model Resource editor suite passed 4 tests including internal-key generation;
  changed files passed Prettier.
- Verification budget: no full suite, complete build, or browser authentication was run. The
  single Phase 15 browser pass remains deferred until Capability details and manual creation use
  the same information hierarchy.
- Next: redesign Capability details and manual creation so normal configuration uses business
  concepts while required public contract and run-method facts remain complete.

### 2026-09-02 — Phase 15 step 2 review correction

- Recommendation names and descriptions now state the user outcome: general and fast
  background removal identify and separate people, products, and common objects; English text
  recognition returns editable text and detected regions. Catalog provenance and validation
  mechanics are not presented as the model's purpose.
- The recommended-model confirmation uses a plain model summary and download size instead of
  rendering internal Catalog prose as a system notice.
- Both ISNet recommendations referenced a nonexistent Hugging Face commit and returned HTTP 404. Their pinned revision is corrected to the repository's verified commit while retaining
  the published model SHA-256 values; ranged download probes now return HTTP 206.
- This remains development data. The attempted patch-version path was removed: the Catalog is
  still the single `2.0.0` baseline with first revisions. Existing development recommendation
  rows and the failed import were deleted, then the corrected baseline was registered once.
- A second live failure showed that Hugging Face's signed download redirect exceeded the
  downloader's 255-character metadata-header limit. Redirect targets now have a separately
  bounded 8 KiB limit and retain the existing HTTPS, DNS-pinning, redirect-count, deadline, and
  maximum-byte checks. The real recommended URL returned its first model-data chunk afterward.
- Unknown custom-model licensing is recorded honestly as `NOASSERTION` instead of blocking the
  user for a license name and URL. Name is prefilled, description is optional, and format is the
  only remaining question when file analysis cannot determine it.
- Download feedback now shows truthful Download, Check, and Add stages with size and waiting
  guidance rather than an indeterminate skeleton. Recommended-model content and actions use the
  product's borderless filled-surface language; error notices remain visually distinct.

### 2026-09-02 — Phase 15 step 3 complete: Capability details and atomic custom creation

- Capability details now explain only what the Capability needs, what it produces, and which
  model or processing source currently provides it. Public field keys and technical Worker or
  Browser method names are no longer shown in the normal view.
- Custom creation asks for name, optional purpose, category, required inputs, and outputs using
  business-facing content types. Capability keys, field keys, contract examples, tags, and
  consumer registration are generated internally; the resulting contract remains discoverable
  by Workflow, Agent, and Canvas without binding the Capability to any one consumer.
- The second step asks only how the Capability is provided. A compatible source automatically
  selects its single Adapter and complete mapping; multiple valid processing methods remain an
  explicit choice. Raw configuration, mapping, priority, and fallback controls are collapsed
  under Advanced settings and open automatically only when one of those values blocks saving.
- Capability-private built-in Adapters remain excluded from manual creation. When no reusable
  model or built-in processing matches the declared inputs and outputs, the user is guided to
  Model services instead of seeing an internal Adapter error.
- The existing atomic server command is unchanged: no Definition exists after the first UI step,
  and the Definition plus its required first run method are created together. The server still
  creates that first binding disabled, so creation never implies that the Capability is ready.
- Focused validation: Web type checking passed; the changed TypeScript and TSX files passed
  ESLint; the Capability definition and implementation editor suites passed 10 tests; changed
  files passed Prettier and `git diff --check`.
- Existing-Chrome acceptance covered one installed Capability detail and both custom-creation
  steps. It verified business labels, hidden field identities, automatic primary output, the
  no-compatible-source recovery path, and the absence of capability-private built-ins. No
  Capability was submitted during this read-only acceptance.
- Verification budget: no full suite or complete build was run. Phase 16 retains the single
  consolidated end-to-end mutation and regression pass, including explicit Catalog update review.
