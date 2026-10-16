# Image text extract acceptance

OCR is an analysis capability and never modifies the source Artifact. A
successful low-confidence result remains successful; a fixed Workflow may
explicitly request Provider review, but Route fallback must not reinterpret low
confidence as execution failure.

Minimum release gates:

- output records oriented source dimensions, full text, language, direction,
  confidence and line/word polygons in source-pixel coordinates;
- the Browser and Worker candidates share one Provider-neutral Contract;
- model files are deployment-owned and no runtime download is allowed;
- no image Artifact is emitted by OCR;
- Eval covers UI screenshots, posters, product packaging, multilingual text,
  small type, rotation and low contrast;
- confidence calibration, character/word accuracy and polygon overlap are
  reported separately.

The reproducible Batch B evaluator reports `characterErrorRate`,
`wordErrorRate`, `meanPolygonIou`, `confidenceBrierScore`, `languageMatch` and
`directionMatch` from digest-pinned OCR JSON. Designer-approved thresholds are
explicit in the corpus Manifest and run through `pnpm eval:batch-b`.
