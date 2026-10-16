# Image object remove acceptance

The explicit Mask is the authority for the editable region. White selects
pixels to remove and black preserves pixels. The normalized Mask must match
the oriented source dimensions and select a non-empty proper subset.

Minimum release gates:

- the Provider receives only the authorized source and Mask;
- output dimensions equal the normalized source dimensions;
- pixels outside the Mask are restored byte-for-byte from the source;
- the repaired image and canonical Removed Region Mask become separate trusted
  Artifacts with Source + Mask lineage;
- the result declares `generative=true` and never claims faithful recovery;
- accepted/unknown Provider side effects never switch channel or resubmit;
- Eval covers flat and textured backgrounds, edge objects, occlusion, large
  regions, nearby text, transparency and identity-sensitive content.

The reproducible Batch B evaluator reports `outsideMaskExactRatio`,
`insideMaskMae`, `insideMaskPsnr` and `seamMae` from digest-pinned source,
candidate, ground-truth and Mask files. Release thresholds are explicit in the
designer-approved corpus Manifest and run through `pnpm eval:batch-b`.
