# Model Source to Capability Closed Loop

- Status: complete — implementation and scoped acceptance finished on 2026-09-02
- Started: 2026-09-02
- Supersedes for current delivery: the phase sequence in
  `MODEL-RESOURCE-CAPABILITY-DELIVERY-PLAN.md`
- User outcome: an ordinary operator can add a model source, turn its verified
  invocation interface into a usable Capability, and later add ordered fallback
  implementations without authoring internal schemas or runtime wiring.

## 1. Completion journey

```text
Add a Provider model or Model Resource
-> establish a trustworthy Native Interface
-> select and verify a Runtime Adapter
-> expose a normalized Invocation Interface
-> create a Capability with an identity mapping by default
-> optionally edit a bounded mapping
-> execute and verify the route
-> enable the Capability
-> optionally add, order, and safely fall back to more implementations
```

Workflow, Agent Skill, and Canvas are later consumers. They do not install, define,
or repair Capabilities and are not part of the source-to-Capability authoring flow.

## 2. Frozen decisions

1. Model Service and Model Resource are the only model-source families in this task.
2. A source's raw API or tensor interface is its Native Interface. A Runtime Adapter
   turns that into the business-shaped Invocation Interface that an operator can use.
3. Simple creation copies the verified Invocation Interface into a new Capability
   Contract and creates one identity-mapped Implementation and Binding.
4. One Capability may have many Implementations. Each independently pins its source,
   Adapter, mapping, eligibility, priority, and fallback policy.
5. The normal flow asks only for business name, purpose, and category. Mapping changes
   are an optional advanced step; arbitrary scripts and runtime code are not accepted.
6. Automatic analysis reads every reliable fact it can. Unknown nonessential facts are
   allowed; a fact required by the chosen Adapter must be established before that route
   can become available.
7. Provider verification belongs to the exact Endpoint, Credential epoch, Model ID,
   API Surface/Operation, Adapter Revision, and request-shaping configuration.
8. A Provider request with an unknown external effect never triggers blind fallback.
9. Recommendations package the same contracts and flows. They do not define a second
   installation or execution architecture and are not installed by Workspace bootstrap.
10. Development-only wrong versions and data may be removed. Published revisions and
    historical executions remain immutable unless the development database is explicitly
    reset.

## 3. User-visible states

- **Needs configuration**: the source is retained, but the requested operation lacks a
  required fact or executable route.
- **Available**: at least one exact route has sufficient evidence and is admitted for
  use.
- **Unavailable**: a previously usable dependency is currently broken or revoked.
- **Disabled**: the operator intentionally stopped the source, Capability, or Binding.

Detailed native schemas, Adapter identities, mappings, revisions, and evidence appear
only in configuration or recovery UI. Internal IDs, digests, storage paths, and secrets
are never ordinary product copy.

## 4. Reference acceptance cases

### Provider model

```text
Configure one image-capable Provider model
-> select one exact supported operation
-> generate the Invocation Interface from its Provider Adapter
-> create an identity-mapped Capability
-> perform one real invocation
-> verify the public output
```

### Model Resource

```text
Install or import one ISNet-class resource
-> read its graph signature and trusted manifest facts
-> verify preprocessing, postprocessing, and Runtime compatibility
-> generate the Invocation Interface from its Runtime Adapter
-> create an identity-mapped Capability
-> run the actual model
-> verify the public output
```

### Ordered implementations

```text
One public Capability Contract
-> Browser implementation first
-> Worker implementation second
-> Provider implementation third
-> fallback only for pinned, effect-safe reasons
```

## 5. Verification authority

- Local model execution is allowed and required when it is necessary to prove the
  Model Resource journey.
- Real Provider validation is authorized up to USD 1 per request and USD 5 total for
  this task. A request whose cost cannot be bounded in advance is not executed.
- Browser acceptance uses only the existing Chrome extension session. If that session
  is unavailable, browser proof is reported as blocked rather than replaced with a new
  browser.
- Focused checks run during implementation. Full tests or a complete build run only if
  shared contracts or the final regression surface require them.

## 6. Baseline evidence audit

| Area                    | Confirmed current fact                                                                                                           | Consequence                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Runtime Adapter         | Already owns normalized `invocationInputSchema` and `invocationOutputSchema`                                                     | Reuse it as the Invocation Interface; do not create a parallel interface abstraction           |
| Model Resource analysis | Custom imports currently detect mainly format and provenance; `nativeInterface` is supplied only by Catalog and remains optional | Custom resources cannot yet establish the required source-to-Adapter compatibility             |
| Provider models         | Model profiles record modalities, operations, parameters, and evidence, while the Adapter owns the exact invocation schema       | Stop inferring operations solely from modalities; resolve an exact model operation and Adapter |
| Capability creation     | The current form asks the operator to design public inputs and outputs before selecting a source                                 | Replace with source-first identity creation and optional advanced mapping                      |
| Capability runtime      | Direct `CapabilityRun`, ordered Bindings, and bounded fallback facts already exist                                               | Extend and reuse this kernel; do not build a second test executor                              |
| Provider recovery       | Unknown external effects already block automatic retry/fallback                                                                  | Preserve this invariant in multi-implementation UX and tests                                   |
| Previous acceptance     | Model Resource execution used a deterministic test Adapter and explicitly skipped local inference                                | Previous completion does not prove the required Model Resource journey                         |
| Working tree            | Twenty-four prior uncommitted paths overlap the target pages and control plane                                                   | Treat every existing change as candidate work; preserve it until classified                    |

Audit conclusion: retain the existing immutable Revision, mapping, ordered Binding,
CapabilityRun, and effect-safe Provider recovery foundations. Revise the current
format-only Model Resource admission, modality-derived Provider operations, contract-first
creation form, and Canvas-only direct-run entry. Preserve the prior pricing, bootstrap,
recommendation, and page-polish changes as overlapping candidate work and verify them in
their owning delivery slices rather than rewriting them opportunistically.

## 7. Delivery slices

1. **Evidence freeze**: finish the code/data/UI audit, draw the journeys, and classify
   every overlapping change as keep, revise, remove, or unrelated.
2. **Source interface closure**: make Provider-model operations and Model Resource
   native interfaces sufficient to admit exact Runtime Adapters.
3. **One-to-one creation**: add source-first creation from model pages and identity-copy
   creation from the Capability page without exposing internal wiring.
4. **Execution proof**: reuse the production CapabilityRun kernel for source and
   Capability validation, including one local model and one bounded Provider execution.
5. **Multiple implementations**: add implementation selection, optional mapping,
   ordering, availability, and effect-safe fallback through the existing Binding model.
6. **Recommendations and recovery**: make recommended installation a preconfigured use
   of the same flow and prove partial-failure recovery.
7. **Consolidated acceptance**: empty Workspace, existing Chrome journey, focused
   database/runtime tests, required shared gates, and exact verification report.

## 8. Drift controls

- No slice is complete unless it advances the completion journey and proves the handoff
  to the next step.
- Object existence, type checks, test counts, and commits do not substitute for the
  named user outcome.
- A contradiction with a frozen decision stops implementation only when it changes the
  product contract, requires an irreversible action, exceeds authorization, or cannot
  be resolved safely inside this task.
- Ordinary code choices, test failures, and reversible corrections are resolved without
  requesting user intervention.
- Commits are scoped to a proven slice and are never pushed without explicit approval.

## 9. Live checklist

- [x] Complete evidence audit and dirty-path classification.
- [x] Draw and inspect the two source journeys plus ordered fallback.
- [x] Replace the stale phase plan as the active delivery authority.
- [x] Close Provider-model Invocation Interface selection.
- [x] Close Model Resource Native Interface acquisition and Adapter admission for ONNX and recommended resources.
- [x] Implement source-first one-to-one Capability creation.
- [x] Implement optional bounded mapping.
- [x] Prove actual local-model execution at the Runtime Adapter inference boundary.
- [x] Prove bounded real-Provider execution.
- [x] Prove ordered, effect-safe fallback.
- [x] Prove recommendation installation and recovery.
- [x] Complete existing-Chrome acceptance and final regression gates.

## 10. Completion evidence

- Existing Chrome: created an image-generation Capability directly from the
  `gpt-image-2` Model Service, executed it as a `user` CapabilityRun, and rendered
  the returned Artifact preview.
- Provider execution: run `[redacted-resource-id]` reached `succeeded`; the
  Provider did not return a trustworthy actual charge, so the authorized USD 1
  maximum remains an `unknown_hold` rather than being invented as consumed or free.
- Model Resource: ONNX graph inspection matched the shipped ISNet signature, and
  the shipped U2-Net model performed real CPU inference. Disposable MySQL tests
  verified the updated Catalog resource, exact Adapter interface digest,
  recommendation installation, and direct user Worker execution.
- Fallback: policy tests verify Browser-to-Worker advancement only for pinned safe
  reasons and block unknown Provider effects. Deadline recovery now distinguishes
  authoritative `not_found`, local `failed/not_started`, and `unknown/manual`.
- Current development data was not reset. Catalog `2.1.0` publishes changed ISNet,
  Runtime Adapter, Implementation, and Binding facts under new revision identities;
  registration retires older recommendations without rewriting their documents.
- The complete production build passed. Changed-file lint, focused unit tests, and
  six disposable-database suites passed. The repository-wide test/type commands
  still expose unrelated existing database mock failures in Attempt completion,
  Browser control-plane, and Workflow reconciliation tests, plus one Worker test-only
  type cast; they are recorded in the final handoff rather than hidden as successful
  full-suite results.

## 11. Repeatable delivery gate

- `0000_initial_schema.sql` remains checksum-stable. Direct `user` CapabilityRuns are
  enabled by `0001_allow_direct_user_capability_runs.sql`, so an existing database can
  upgrade without a manual constraint edit or initial-migration checksum drift.
- Catalog `2.1.0` is safe to register after `2.0.0`: changed model recommendations use
  revision 2 and changed executable assets use new immutable revision identities.
  Older recommendations are retired, while a fresh Workspace can publish the selected
  Catalog model directly at its declared revision.
- The reproducible acceptance command is `pnpm test:source-capability-closure`. It
  covers the public source-to-Capability contracts, source analysis, exact Adapter
  admission, direct user execution, safe fallback, Catalog upgrade, and disposable
  MySQL installation. It includes the real local U2-Net inference test and therefore
  must only run where local-model execution is permitted.
- A live Provider request is not part of the repeatable command because credentials,
  billing, and remote side effects are environment-owned. The bounded Provider canary
  remains a separate acceptance action; deterministic Provider transport and runtime
  seams stay in the repeatable gate.

## 12. Download trust follow-up

- Recommended model rows now expose the two facts needed before commitment:
  execution location and download size. They reuse Catalog facts and existing
  business labels rather than introducing another recommendation model.
- URL and Catalog imports persist received bytes and expose them through the public
  import summary. The page derives progress from received versus expected bytes;
  unknown-size imports remain indeterminate instead of inventing a percentage.
- Cancellation is an idempotent, authorized request on the import itself. The Worker
  observes it while streaming, stops before committing the model, marks the import
  `cancelled`, and makes the partial upload eligible for existing cleanup.
- Existing Chrome acceptance proved the ordinary-user path: compare the remaining
  recommendation (`Cloud execution - 168.0 MB`), start it, observe live byte progress,
  cancel it, reach `Download cancelled`, and return to the confirmation step with
  `Retry`.
- A real-chain correction is covered by the Worker test: storage adapters may wrap
  the stream cancellation while cleaning temporary bytes, so cancellation is
  recognized through the bounded error-cause chain rather than misreported as model
  analysis failure.

## 13. Capability test lifecycle follow-up

- Direct Capability tests now use the existing governed cancellation route. While a
  Run is queued or running, the dialog cannot be dismissed into an invisible
  background execution and offers `Cancel test` instead.
- Completed, failed, and cancelled Runs retain the entered input and can start a new
  Run in place. Cancellation has its own terminal explanation instead of appearing as
  a failure.
- API and runtime failures are translated into bounded recovery guidance; raw error
  codes and JSON are no longer rendered to operators. Declared outputs keep their
  business labels, while structured values are summarized without exposing raw JSON.
- Component, transport, type, lint, and build checks cover the change. Fresh existing-
  Chrome acceptance remains required because the available extension session returned
  `Debugger unattached`; no replacement browser was started.

## 14. Source-derived Capability presentation follow-up

- The default Capability directory now separates active and archived records, keeping
  recoverable history available without mixing stale test entries into normal work.
- Operator details and direct tests filter the internal `schemaVersion` output for
  every Capability, including immutable Catalog declarations created before the
  source-first work.
- Selecting a Runtime Adapter still derives the public fields and suggested name, but
  no longer copies its protocol-oriented description into the Capability's business
  description. Known Provider image fields receive current bilingual labels, and test
  forms visibly mark required fields.
- Existing Chrome acceptance archived the stale active model-service Capability,
  created a new `Image generation` Capability from `TokenHub - gpt-image-2`, and
  confirmed the clean field list and hidden result version. A real user Run exposed
  only `Cancel test` while active, reached `Test cancelled` after the bounded Provider
  cancellation deadline, retained the input, and offered `Run test again`. The Provider
  outcome remained unknown,
  so no external result was inferred and no second Provider request was made.
