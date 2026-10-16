# Image quality assess acceptance

This capability emits quality facts only. It never mutates the source and does
not automatically invoke a repair capability.

Minimum release gates:

- blur, under/over exposure, noise, compression and optional subject scale are
  normalized and independently reported;
- findings and usability are deterministic projections of pinned thresholds;
- Browser and Worker produce bounded metric drift on identical decoded RGBA;
- Eval uses controlled degradations plus designer-labeled real images across
  photos, UI, products, text, transparency and gradients;
- ROC/precision-recall per finding and Browser/Worker drift are reported;
- no external egress, Provider charge or output Artifact occurs.

`pnpm eval:batch-c` pins evidence files and reports `scoreMae`,
`findingPrecision`, `findingRecall`, `findingF1` and `usabilityMatch`.
