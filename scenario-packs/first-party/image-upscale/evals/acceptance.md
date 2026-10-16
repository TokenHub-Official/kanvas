# Image upscale acceptance

`qualityIntent=faithful` is a deterministic 2× resample. It must not invent
detail and must preserve alpha, composition, geometry and text structure.

`qualityIntent=reconstructive` explicitly permits generated detail. It must be
evaluated separately for text mutation, face/identity change, geometry drift,
hallucinated detail, latency and charge. A reconstructive result must never be
represented as faithful.

Minimum release gates:

- faithful output dimensions equal the oriented source dimensions multiplied
  by two;
- faithful output declares `generative=false` and `lanczos3`;
- reconstructive intent advances from the Worker before image bytes are read
  and uses only the pinned Provider route;
- both paths create one trusted `image.upscaled` Artifact with source
  provenance, exact Usage and immutable Attempt completion facts;
- Provider Unknown Side Effect never falls back automatically;
- text-heavy, face, product, illustration, transparency and compression-risk
  samples remain in the Eval corpus.
