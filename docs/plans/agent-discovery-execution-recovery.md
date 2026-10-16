# Agent discovery, execution and recovery reliability plan

Status: local implementation and verification completed for the bounded changes below; production configuration and canary pending. Original analysis: 2026-09-20 UTC.
This document does not claim production root-cause closure or completed implementation.
The detailed sections below remain the design rationale, not a claim that every proposed optimization was implemented.

## Objective and acceptance boundary

A configured, authorized image capability must be discoverable and invokable by an
Agent, or yield an accurate, actionable reason that survives through diagnostics.
Sending, clarification, stopping, retrying, reconnecting and selecting a response
must preserve input, output and execution identity. Success requires a real image
Artifact and a consistent terminal Run, not merely generated explanatory text.

Reuse Kanvas authorization, ActionReceipt, Provider routing, effective invocation
schema projection and MySQL ownership. Do not add a second execution engine, global
catalog cache, vendor-specific image bypass or a new orchestration framework.

## Evidence and limits

| Finding                                                 | Evidence                                                                                                                                                                                                                  | Classification                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Management and discovery use different readiness checks | `capability-binding-admin-store.ts:availabilityReason` checks binding dependencies; `capability-definition-admin-store.ts:searchAgentCatalog` additionally gates invoker/surface and projects effective Provider schemas. | Confirmed structural difference; not proof of the specific production exclusion.                            |
| Unavailable candidates lose their explanation           | SQL filters them before projection; projection returns `unavailable` with reasons, but discovery uses `continue` and returns an array.                                                                                    | Confirmed loss of diagnostic information.                                                                   |
| Keyword queries repeat expensive work                   | Discovery projects up to 500 candidates sequentially before keyword filtering. Worker repeats an unfiltered search on a miss.                                                                                             | Confirmed work amplification; its share of the observed latency is unmeasured.                              |
| Catalog completeness is not represented                 | Candidate query has `LIMIT 500`, results are sliced to at most 50, and the Worker requests 20. No completeness or cursor accompanies results.                                                                             | Confirmed limitation; callers must not infer global absence from a bounded subset.                          |
| Exact invocation depends on search                      | `capability-catalog-executor.ts:invoke` uses a 50-result substring search and then finds the exact key.                                                                                                                   | Confirmed fragile lookup; exact invocation should not depend on ranking or result caps.                     |
| Visible streaming and final text disagree               | Worker previously reset text on each stream start, then persisted aggregate text on completion.                                                                                                                           | Reproduced and locally patched in the preceding work.                                                       |
| Sequential tools are mistaken for parallel tools        | Mastra combines steps in one message; the original question validator inspected all tools in that message.                                                                                                                | Reproduced and locally patched; real same-step conflicts remain rejected.                                   |
| Error classification is too coarse                      | Question payload, input identity, continuation and parallelism checks share one `agent.question_parallel_tool_calls` error. Schema projection also collapses some unexpected exceptions into availability reasons.        | Confirmed diagnostic ambiguity.                                                                             |
| Snapshot ordering is not explicit                       | SSE sends changed full snapshots; the Web callback replaces cached state directly. Existing-message writes do not increment Thread.version.                                                                               | Confirmed missing ordering contract; an observed stale-error race has not been proven.                      |
| Image availability differs across live views            | In the previous turn, management showed image generation ready; the failed conversation reported an empty catalog.                                                                                                        | Observed discrepancy; exact tool response, historical configuration and filtering reason remain unverified. |

The previous live diagnostics contained seven model-call timestamps spanning 92
seconds. This is not a measured breakdown of queue, model, tool and persistence time.
The deployment browser session expired before runtime logs could be obtained.

## 1. Establish the production exclusion before changing admission

Follow the two image capability identities in the affected Workspace through one
read-only evaluation under the failed Run's authority and invoker context. Capture:

- candidate presence, published contract/declaration revisions and Agent eligibility;
- enabled bindings, Adapter readiness and effective Provider route/parameter result;
- Server and Worker build/configuration digests relevant to deployment policy;
- evaluation time and configuration revisions, distinguishing current observations
  from facts retained for the historical Run;
- original discovery receipt/result when retained, including errors instead of relying
  only on the assistant's summary of the tool response.

Use existing records and diagnostic facilities first. If they cannot retain the
exclusion, add the minimal structured evaluation result described below. Do not
change production bindings, model choices or admission rules to make the catalog
nonempty. Never dump credentials, raw environment values or signed asset URLs.

Deliverable: each image capability has one traceable decisive exclusion or a verified
ready result. Preserve explicitly unknown historical facts. This is the entry gate
for calling the image-discovery incident resolved.

## 2. Give availability one owner and preserve context

Factor a capability-readiness module at the existing database/application seam,
reusing Provider route resolution and effective schema projection internally.
Its callers are management, Agent discovery and exact invocation preparation.

The input includes Workspace, trusted authority, invoker/surface, capability key or
bounded candidate identities, evaluation time and current deployment policy. The
output has a small discriminated contract:

- `ready`: exact revisions, effective public input schema and internal eligible-route
  facts used by execution preparation;
- `unavailable`: stable reason, failed stage and recovery category;
- `unknown`: infrastructure/evaluation error, with a diagnostic reference and whether
  a bounded retry is appropriate.

All successful lookups distinguish existence, caller eligibility and readiness.
Permission filtering must precede disclosure. Do not reveal names, hidden-resource
counts or configuration details to an unauthorized caller. Administrators may inspect
additional reasons through their existing authorized detail/diagnostic views.

Same facts and same context must produce the same decision. Different user/Agent
permissions or surfaces can legitimately produce different outcomes; the UI must
not flatten those into a universal "executable" label. Management can distinguish
configured state from current Agent usability using this shared result.

Discovery is not authorization to execute later. Invocation resolves the exact key
without search or pagination, reevaluates admission and current parameters, and
then enters existing preparation, budget, approval and idempotency machinery. A
configuration change returns a specific recoverable result; it never silently picks
an unrelated capability or bypasses a check.

Known domain failures retain their reason. Unexpected exceptions remain evaluation
errors; they must not become "no capabilities" or generic schema conflicts.

## 3. Bound discovery work without depending on model obedience

Separate bounded metadata selection from expensive readiness evaluation. Prefer
exact key matches, then business-name/tag matches; paginate explicit fallback
results. Remove the accidental assumption that the first 500 definitions constitute
the complete Workspace catalog. Use stable ordering/cursors or a bounded indexed
query; expose incomplete coverage when a configured limit is reached.

Return separate fields for match outcome, readiness outcome, completeness, cursor
and safe recovery information. Distinguish:

- no matching visible capability;
- matching capability temporarily/configurationally unavailable;
- confirmed complete empty eligible catalog;
- incomplete search or evaluation failure.

Reuse the same candidate/readiness evaluation within a discovery episode instead
of rerunning full projection for every synonym. Scope any short-lived reuse to Run,
authority, invoker and configuration snapshot, with a bounded freshness policy.
Never cache authorization failures or transient errors as durable absence. Explicit
refresh, new Run, resume/configuration change and expiry must allow reevaluation.
Execution always revalidates regardless of discovery reuse.

For a proven complete empty catalog, the runtime can stop redundant discovery for
that episode, returning the same structured outcome and taking the search tool out
of subsequent steps where supported. Restore it at defined refresh boundaries.
For repeated identical read-only searches without new evidence, apply a bounded
no-progress policy; permit meaningful alternative queries and other tools. Do not
apply output reuse or deduplication to business mutations indiscriminately.

The earlier `availableCatalogEmpty` plus instruction patch is provisional. Replace
its truth source with this explicit contract; prompting is explanatory, not the
mechanism that guarantees bounded work or accurate diagnosis.

## 4. Make Run, attempt, step and response identity explicit

Keep the local step-boundary fix, but normalize framework events within
`@kanvas/agent-runtime` so Worker code consumes Kanvas step/attempt identities rather
than inferring them from a Provider stream opening. Contract tests must cover the
pinned Mastra message format and upgrades.

Maintain one bounded response projection for streaming, persistence and reload.
A new model step may add a paragraph; a transport retry is not a new logical step.
A resumed question continues the same Run. Never silently merge a failed attempt's
partial text with its replacement. Preserve useful interrupted output with an
accurate state when replacement is necessary.

Separate question failure codes for same-step conflicts, payload identity mismatch,
invalid input identity and missing/corrupt continuation. Detect a mixed suspension
and business-action step before dispatch where the adapter permits it. Otherwise
fail safely with recorded execution facts; do not replay actions that may already
have run. Bounded model correction is appropriate only before effects occurred.
Persist question/checkpoint/Run suspension atomically using the existing lifecycle.

Define a durable monotonic conversation-view revision covering visible message
updates, Run/interaction transitions and branch changes. Existing Thread.version
alone is insufficient because message updates do not advance it. Prefer a dedicated
view revision so stream writes do not invalidate unrelated optimistic mutations.
Read coherent snapshots, and use one merge rule for SSE, HTTP polling and mutation
responses. Old revisions or closed subscription generations cannot overwrite newer
state. Client time and snapshot arrival order are not ordering authorities.

Thread, Run and message identities stay attached to errors and actions. Once a new
retry is accepted, delayed old-run snapshots must not reactivate its error. Historical
failure remains with its historical response. A fresh failure on the new Run remains
visible. Add claim-token/lease fencing to streamed writes if the write path cannot
already prove current Worker ownership; a running status alone does not fence an
expired Worker after reclamation.

Retry means a new processing attempt with retained history. Distinguish retrying a
failed/unknown business operation from an explicit request for a new image:
reuse/reconcile the original invocation when recovering an accepted operation;
create a new operation only for explicit regeneration. Honor existing receipts,
Provider request identity and billing recovery before repeating a side effect.

## 5. Measure and reduce latency at its source

Reuse current model observations and Run timing; join them with tool receipts into
one bounded diagnostic timeline. Record queue wait, model preparation, first output,
model duration, tool duration, readiness projection and persistence delay, along
with step count and repeated-read count. Show users the current activity, while
keeping technical timing and reason codes in diagnostics.

First eliminate duplicate catalog projection and invalid query loops. Then use
measurements to decide whether bounded independent read concurrency is worthwhile.
Do not parallelize dependent calls or business mutations as a generic optimization.
Do not change the user's model or reasoning setting to conceal platform overhead.

Set performance gates on representative fixtures and recorded baselines: query/
projection counts, queue/first-output/total latency percentiles and repeated-read
counts. Never promise a fixed total latency for an external image model without
measuring that route. Preserve honest timeout and cancellation behavior; do not
replace failures with indefinite spinners.

## 6. UI behavior and acceptance

Follow the existing `user-centered-ui-ux` rules and product design system.

- Running with an empty draft: one Stop control. With a draft: compact Send plus
  Stop; successful send visibly retains the pending message in the existing pending
  list, so removing queue wording does not hide delivery semantics.
- Running/stopping: no branch switch or second regenerate. Server restrictions still
  enforce the same rule. Cancellation acknowledgement owns the terminal state.
- Retry accepted: new attempt owns the current status; preserve draft and history.
- Waiting for clarification: show the existing question card and resume the same Run.
- Unavailable capability: give the shortest true reason and an authorized recovery
  action. Do not put internal keys or routing details into normal conversation UI.
- Success: show the returned image and durable result; refresh retains it.

## Delivery order and decisive tests

| Stage | Change boundary                                                              | Acceptance gate                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Diagnose affected image identities and establish shared readiness contract   | Every exclusion is attributed; same context gives the same decision in management/discovery/preparation. Unknown historical facts remain labeled.                                            |
| B     | Exact invocation plus bounded, typed discovery                               | Test no-match vs unavailable vs error; more-than-limit catalogs; exact key beyond a search page; configuration/permission changes; no repeated full projection for synonym queries.          |
| C     | Step/attempt normalization, question recovery, snapshot ordering and fencing | Real adapter tests; delayed old failure after new success; SSE/HTTP reordering; stop-vs-final-write; lease reclamation; restart during clarification; no duplicate accepted image execution. |
| D     | UI and production canary                                                     | Existing Chrome completes send → discover → image task → result → refresh, and failure → repair → retry → success. Verify drafts, branches, questions and current errors throughout.         |

Each stage includes focused checks at its real caller seam. Shared readiness needs
real database integration cases, not only mocked array responses. Frontend tests
must deliberately reorder observations; static markup cannot prove recovery.
External image canaries use a bounded authorized test context and measured cost.
Do not run local models.

Additive contracts/schema changes deploy before new writers/readers. During a rolling
upgrade, do not advertise reliable revision ordering until all relevant writers
advance it. Keep legacy parsing/checkpoint compatibility for in-flight Runs; drain
or version-gate incompatible runtime changes. Roll back application code without
destructively rolling back additive persisted state.

The existing UI/streaming/question fixes are useful local repairs but are not the
acceptance gate for this plan. Production discovery, real image output and recovery
must all pass before declaring the incident closed.

## Delivery boundaries

The local implementation covers shared Agent readiness, typed paginated discovery,
exact invocation, persistent exclusions, missing-policy preflight, question error
classification, model-call/attempt stream identity, independent view revisions,
stale-snapshot rejection, Worker write fencing and conservative retry protection
for accepted business work. It retains existing Provider reconciliation instead of
adding automatic replay. It does not add a global cache, general Tool parallelism,
or promise measured external latency improvements. Real Provider canary and rollout
remain required. The current deployment exclusion is now confirmed as missing
Provider deployment bounds; its proposed narrow repair passed read-only evaluation.
