# Image denoise acceptance

This capability is a faithful deterministic repair. It may suppress local
noise but must not invent texture, rewrite text, change identity, move edges
or alter Alpha.

Minimum release gates:

- output dimensions and Alpha equal the normalized source;
- method, strength, kernel and noise estimate are recorded;
- the same source, parameters and implementation revision produce identical
  bytes;
- text/edge/texture preservation thresholds are evaluated separately from
  noise reduction;
- transparent, flat-color, UI text, product, face, fabric and high-frequency
  samples remain in the Eval corpus;
- no external data egress or Provider cost occurs.

The reproducible Batch B evaluator compares candidate and clean ground truth
against the noisy baseline. It reports `candidatePsnr`, `baselinePsnr`,
`psnrGain`, `edgeRetention` and `alphaExactRatio`; designer-approved thresholds
are explicit in the corpus Manifest and run through `pnpm eval:batch-b`.
