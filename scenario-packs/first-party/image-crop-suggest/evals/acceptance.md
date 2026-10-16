# Image crop suggest acceptance

This analysis capability does not modify the source and emits no Artifact.
Suggestions are ordered independently for each requested aspect ratio.

Minimum release gates:

- every crop is inside oriented source bounds and matches the requested ratio
  within one output pixel;
- subject retention, confidence, rank and normalized bounds are explicit;
- supplied subject bounds remain authoritative evidence rather than hidden
  model state;
- the same pixels, inputs and algorithm revision produce identical output;
- Eval covers portraits, products, multiple subjects, off-center subjects,
  text-heavy layouts, empty margins and panoramic images;
- retained subject area, saliency retention and designer top-choice rate are
  reported separately.

`pnpm eval:batch-c` pins evidence files and reports `meanTopOneIou`,
`topThreeHitRate` and `meanSubjectRetention` against designer-approved crops.
