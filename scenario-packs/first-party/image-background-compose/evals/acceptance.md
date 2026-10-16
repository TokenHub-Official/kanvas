# Image background compose acceptance

Composition is deterministic image rendering, not generation. It emits one
composed image and one white-foreground/black-background Composition Mask.

Minimum release gates:

- foreground, optional Mask and background inputs are independently authorized;
- resolved placement is inside the requested canvas and records exact geometry;
- `contain`, `cover` and `stretch` have pinned interpolation and crop semantics;
- output Alpha follows source, optional Mask, opacity and background Alpha;
- identical normalized inputs and revision produce identical PNG bytes;
- both Artifacts retain complete input and geometry lineage;
- Eval covers transparent edges, color/image backgrounds, all fit modes,
  off-center placement, partial Alpha and maximum supported dimensions;
- Browser and Worker pixel drift, edge seam error and Mask IoU are reported.

`pnpm eval:batch-c` pins evidence files and reports `pixelExactRatio`,
`channelMae`, `alphaExactRatio` and `compositionMaskIou`.
