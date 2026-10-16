# Single-image background-removal acceptance

This pack is the production contract and Board Entrypoint for
`image.background.remove@1`.

- Accept only committed JPEG, PNG or WebP Artifacts authorized in the current
  Workspace.
- Produce two immutable PNG Attempt outputs: transparent `foreground` and
  grayscale `mask`. The capability result must reference both adopted
  Artifacts.
- Route only to a digest-pinned U-2-Net implementation. Worker model bytes are
  mounted by deployment; Browser model bytes are pinned by the Browser Runtime
  Release. Runtime model downloads from arbitrary URLs are forbidden.
- The admitted upstream code license is Apache-2.0. Every deployed weight file
  must have an explicit variant, SHA-256 digest, source record and license
  record before activation.
- Evaluate at least people, products, animals, hair/fur, transparent objects,
  low contrast, shadows and already-transparent sources. Record foreground
  IoU, boundary F-score, empty/full-mask rate, latency, peak memory and
  fallback rate by implementation revision.
- Browser and Worker implementations must satisfy the same input/output
  contract. Quality signals are diagnostics, not an automatic acceptance
  decision.
- The Board must show preview first. Replacing the source is always an explicit
  Editor Command and must remain undoable.
