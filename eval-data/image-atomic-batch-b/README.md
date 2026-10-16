# ATOM-BATCH-02 quality corpus

`@kanvas/image-atomic-eval` evaluates quality independently from execution
success. Copy `manifest.example.json` to `manifest.json`, add anonymized source,
candidate and approved ground-truth files, change `evidenceClass` from
`template` to `designer_approved`, then run:

```bash
pnpm eval:batch-b --manifest=eval-data/image-atomic-batch-b/manifest.json
```

Every sample pins the Implementation digest, execution target, evidence-file
digests in the generated report and explicit per-metric thresholds. The corpus
must cover:

- object removal: simple/complex objects, texture continuation, shadows,
  occlusion, thin boundaries and transparent material;
- denoise: flat color, text/UI, product edges, skin, repeated texture, color
  noise and transparency;
- light enhancement: under/over exposure, mixed white balance, skin/product
  color, gradients and transparency;
- text extraction: UI screenshots, posters, packaging, multilingual text,
  small type, rotation and low contrast.

Metrics are capability-specific:

- object removal: exact Mask-outside restoration, Mask-inside MAE/PSNR and seam
  MAE;
- denoise: PSNR gain over the noisy source, edge retention and exact Alpha;
- light enhancement: improvement against approved target, luminance error,
  clipping and exact Alpha;
- OCR: CER, WER, polygon IoU, confidence Brier score, language and direction.

Thresholds in the example are starting points, not release claims. A designer
must approve thresholds and ground truth for the actual corpus before the
report can serve as release evidence.

`regression-v1/manifest.json` is executable `metric_regression` evidence. It
proves deterministic candidate generation, file decoding, metric calculation,
threshold enforcement and report integrity for denoise and light enhancement.
It is not a substitute for Provider object-removal or OCR quality review.
