# ATOM-01 local Eval data

This directory is intentionally excluded from Git except for this README and
the manifest template. Put only anonymized, approved design-work samples here.

Required structure:

```text
corpus.json
sources/
masks/
browser/results.json
browser/masks/
worker/results.json
worker/masks/
report.json
```

`corpus.json` must contain 30-50 samples, cover every category enforced by
`@kanvas/background-remove-eval`, include the current-tool/manual-time/rework
baseline, and include a designer Mask for every sample expected to be usable.

Run:

```bash
pnpm --filter @kanvas/background-remove-eval build
node tools/background-remove-eval/dist/cli.js \
  --corpus=eval-data/background-remove/corpus.json \
  --browser-results=eval-data/background-remove/browser/results.json \
  --worker-results=eval-data/background-remove/worker/results.json \
  --out=eval-data/background-remove/report.json
```

The report cannot pass while thresholds are absent. Thresholds become valid
only when `approvedBy` and `approvedAt` record the designer decision.
