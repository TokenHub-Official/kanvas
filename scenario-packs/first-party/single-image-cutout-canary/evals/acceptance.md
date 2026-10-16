# Canary acceptance

This pack proves the generic Artifact-backed Workflow execution boundary only.

- Install only in a disposable test Workspace.
- Bind `test.image.background.remove@1` to a deterministic test
  implementation whose Adapter Key is
  `test.deterministic.image-derived-png.v1`.
- Invoke the Workflow with exactly one authorized `sourceArtifactId` from the
  current Workspace.
- The implementation must create a real Attempt output Artifact and return
  `kanvas.deterministic-image-result/v1` with `imageArtifactId`, the original
  `sourceArtifactId`, and its `capabilityRunId`; copying the source Artifact is
  not a valid result.
- The Adapter output is a transparent PNG swatch derived from the complete
  source SHA-256. It proves byte flow and determinism only; it is not evidence
  of background-removal quality and must never be enabled in production.
- A real development/test Worker registers it only when
  `KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED=true`, the `execution`
  role is active and a trusted Storage profile is configured. Production
  config must reject the flag.
- Assert keyed start replay, pinned Skill and Workflow revisions, immutable
  Attempt output materialization, result projection after refresh, and an
  explicit retry after failure.
