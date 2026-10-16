# Image palette extract acceptance

Palette extraction is Browser-only deterministic analysis. Pixels never leave
the browser and no Artifact is emitted.

Minimum release gates:

- colors are reported in sRGB with uppercase Hex, RGB, luminance and normalized
  proportions;
- ignored transparency and sampled pixel count are explicit;
- ranking and role assignment are stable for identical input and parameters;
- Eval covers flat graphics, gradients, photos, transparent art, dominant
  neutrals, small accents and near-duplicate colors;
- palette coverage error and cross-device byte equality are reported.

`pnpm eval:batch-c` pins evidence files and reports `weightedColorDistance`,
`weightedProportionError` and `paletteCoverage` against an approved palette.
