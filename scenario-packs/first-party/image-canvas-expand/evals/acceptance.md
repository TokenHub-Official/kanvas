# Image canvas expand acceptance

Release-gate samples must cover product photography, people, text-bearing
packaging, hard geometric edges, transparency and several source placements.

The automated gate verifies:

- target dimensions exactly match the request;
- the decoded RGBA pixels in Source Placement exactly match the normalized
  source pixels;
- Generated Region Mask is black in Source Placement and white elsewhere;
- both output Artifacts retain Source Artifact lineage and placement facts;
- the external invocation records duration, token usage and settled cost.

The human gate reviews seam continuity, duplicated objects, warped text,
identity drift, lighting continuity and implausible generated details. No
sample may be accepted solely because the original region was restored after
generation.
