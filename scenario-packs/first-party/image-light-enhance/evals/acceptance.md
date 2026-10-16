# Image light enhance acceptance

This capability applies a deterministic tone and white-balance transform. It
does not perform semantic relighting and must declare `generative=false`.

Minimum release gates:

- output dimensions and Alpha equal the normalized source;
- exposure, shadows, highlights, temperature and tint are fully recorded;
- transparent pixels remain byte-stable and visible Alpha is unchanged;
- low/high clipping ratios are emitted as quality signals;
- identical input and parameters produce identical bytes;
- Eval covers under/over-exposure, backlight, color cast, skin tone,
  transparent art, UI screenshots and product color accuracy;
- no external data egress or Provider cost occurs.

The reproducible Batch B evaluator compares the candidate and original source
against an approved target. It reports `candidateMae`, `baselineMae`,
`maeImprovement`, `luminanceMae`, `clippedRatio` and `alphaExactRatio`;
designer-approved thresholds are explicit in the corpus Manifest and run
through `pnpm eval:batch-b`.
