# ATOM-01 reliability and security matrix

This matrix maps the capability-specific risks to executable evidence. It does
not replace the final real-infrastructure run.

| Risk | Required behavior | Automated evidence |
| --- | --- | --- |
| Dispatch authorization | Reauthorize Human Workspace and `capability.run` before creating a Run | `workspace-content.controller.test.ts`, Workflow Run controller tests |
| Input isolation | Adapter opens only an Artifact ID present at an explicit Attempt-input JSON Pointer and never sees a Storage key | `worker-input-artifact-resolver.test.ts`, `u2net-background-remove-adapter.test.ts` |
| Model/release drift | Browser and Worker fail closed unless variant, weight digest, engine version and Browser asset paths match the immutable ImplementationRevision | `bootstrap-atomic-scenario.test.ts`, `browser-background-remove-runtime.test.ts`, `config.test.ts` |
| Apply authorization | Re-read current Human Workspace permissions and re-download the result Artifact before an Editor Command | Canvas Workspace implementation plus final browser loss-of-authority journey |
| Output trust | Allocate, ingest, verify and atomically adopt foreground and mask | `worker-attempt-output-materializer.test.ts`, `browser-executor-control-plane.service.test.ts`, Attempt completion tests |
| Lineage | Accept `sourceArtifactId` only when it is pinned in authoritative Node input; commit `derived_from` in the same transaction | `attempt-completion-store.test.ts`, final MySQL Artifact-edge query |
| Completion audit | Commit the system completion Audit with Artifact, lineage, Usage, completion and Outbox facts in the same transaction | `attempt-completion-store.test.ts`, final MySQL Audit timeline query |
| Duplicate complete | Same manifest replays without another completion or Outbox fact | `attempt-completion-store.test.ts`, `browser-executor-transport.test.ts` |
| Upload failure | No Complete when allocation, ingestion or verification fails | Worker output materializer tests and Browser Control Plane tests |
| Lease loss | Abort work and prevent late Complete | `workflow-execution.processors.test.ts`, Browser heartbeat/control-plane tests |
| Cancellation race | Acknowledge cancellation before, during and immediately before Complete | `workflow-execution.processors.test.ts`, Browser cancellation tests |
| Browser fallback | Only `not_started`, Browser fence or Browser lease expiry can advance the pinned route | `attempt-transition-policy.test.ts`, final forced-fallback journey |
| Source mutation | Never silently replace a deleted, moved or changed source Node | `canvas-operation-runtime-v1.test.ts`, final browser source-change journey |
| Refresh and response loss | Restore the pinned Run, preview, Mask and Asset adoption ID; replay rather than duplicate | Canvas Operation recovery/runtime tests, transport replay test |
| Multi-tab conflict | Draft optimistic locking remains authoritative | Canvas Draft controller/store and browser conflict journey |
| Logout or lost authority | Grant-owned claimed work may converge, but UI cannot apply or save without fresh authority | Browser Control Plane tests and final browser loss-of-authority journey |

The final evidence bundle must record the exact test command, Git commit,
runtime release/model digests, MySQL query results, browser screenshots and
the forced-fallback/source-change/response-loss observations.
