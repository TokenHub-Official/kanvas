# ATOM-BATCH-03 quality corpus

Copy `manifest.example.json` to `manifest.json`, add anonymized candidate and
designer-approved ground-truth files, change `evidenceClass` from `template`
to `designer_approved`, then run:

```bash
pnpm eval:batch-c --manifest=eval-data/image-atomic-batch-c/manifest.json
```

The generated report pins every evidence file, Implementation digest and
execution target. Metrics remain capability-specific:

- crop suggest: top-one bounds IoU, top-three hit rate and subject retention;
- palette extract: weighted RGB distance, proportion error and palette
  coverage;
- quality assess: score MAE, finding precision/recall/F1 and usability match;
- background compose: exact pixels, channel MAE, Alpha equality and
  Composition Mask IoU.

The example thresholds are starting points only. Release evidence requires
designer-approved targets and a corpus covering every category listed in the
four Scenario acceptance documents.

`regression-v1/manifest.json` is executable `metric_regression` evidence for
all four deterministic Batch C implementations. It proves the pinned
algorithms and Eval/report pipeline; crop preference and diagnostic usability
still require independent designer review before release.
