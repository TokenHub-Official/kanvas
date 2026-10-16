# image.subject.detect acceptance

Eval corpus must contain ordinary products, people, multiple separated
subjects, small subjects and complex backgrounds. Browser and Worker use the
same admitted IS-Net family and must be compared on candidate count, bounds
IoU, confidence drift, mask IoU, latency and peak memory.

The current taxonomy is deliberately class-agnostic:
`category=visual_subject`, `taxonomy=class_agnostic_isnet`. It is a visual
subject proposal capability, not a COCO object classifier. Semantic labels
must be introduced through a separately evaluated Contract revision.

Minimum release gates:

- ordinary product/person primary-subject bounds IoU >= 0.85;
- Browser versus Worker primary-subject bounds IoU >= 0.90;
- candidate confidence absolute drift <= 0.08;
- no source image mutation and no implicit subject extraction;
- deterministic ordering by area, confidence, top and left;
- cancellation, browser fence and lease expiry enter the fixed Worker
  fallback route without reusing a stale Browser completion.
- the Browser attempt budget is shorter than the workflow budget so
  `not_started` fallback leaves enough time for a Worker attempt.

The quantitative release gate uses samples whose existing designer review is
`direct_use` or `mask_repair`. Samples already classified
`fail_or_fallback` remain in the report as an adversarial set and must never
be deleted to improve an aggregate. This preserves the explicitly accepted
CAMO limitations while keeping ordinary product, person, multi-subject,
small-subject and complex-background coverage in the release set.
