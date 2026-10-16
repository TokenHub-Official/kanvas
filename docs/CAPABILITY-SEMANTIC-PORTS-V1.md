# Capability semantic ports v1

Semantic ports let the Workflow authoring UI match business roles instead of guessing
from field names. They complement, but never relax, JSON Schema validation.

The current catalog projects semantic types and cutout bundles. Workflow drafts store
references as `nodeId + outputKey`; compiled runtime values remain explicit node-output
references. Bundle metadata is currently an authoring and compilation fact, not a
separate persistent runtime lineage identity.

## Two type layers

Every port has:

```text
Contract type: string, number, object, or array plus JSON Schema constraints
Semantic type: artifact.image, artifact.mask, layout.canvas, and other business roles
```

Contract type governs serialization and final validation. Semantic type governs
visible candidates, automatic connection, and composed editors.

## Vocabulary

The v1 registry contains:

```text
value.any
text.plain
prompt.rich
number.scalar
boolean.flag

artifact.any
artifact.image
artifact.image_list
artifact.foreground
artifact.mask
artifact.background

layout.canvas
layout.placement
layout.bounds
background.source
region.list
quality.signals
```

The registry, not a plugin, defines base contract types, assignability, allowed
editors, and security characteristics.

## Assignability

Assignability is explicit and one-way:

```text
artifact.foreground -> artifact.image -> artifact.any
artifact.background -> artifact.image -> artifact.any
artifact.mask       -> artifact.any
artifact.image_list -> artifact.any
```

`background.source` accepts an ordinary image, background, or foreground. A normal
image cannot satisfy `artifact.foreground`; a mask does not become an ordinary visual
image merely because its storage format is an image.

An upstream candidate must satisfy all of the following:

1. It is reachable in control flow.
2. Its source node succeeds before use, or satisfies an explicit terminal rule.
3. Contract JSON types are compatible.
4. Semantic types are assignable.
5. Workspace, permissions, data classification, and Artifact lifecycle permit use.
6. Any bundle constraint is satisfied.

## Reference identity

A persistent reference is bound to a node:

```json
{
  "source": "node_output",
  "nodeId": "remove-background-1",
  "outputKey": "foregroundArtifactId"
}
```

The interface may display “Background removal / Foreground,” but display names, field
labels, and array positions are never identity. Publication resolves `nodeId` to the
Revision's stable node key and contract output.

## Bundles and derivation

Outputs from one operation that must share spatial, temporal, or model provenance use
a bundle:

```yaml
outputs:
  - key: foregroundArtifactId
    semanticType: artifact.foreground
    bundle:
      key: cutout_result
      role: foreground
  - key: maskArtifactId
    semanticType: artifact.mask
    bundle:
      key: cutout_result
      role: mask
```

The same bundle key on different nodes or map scopes does not mean the same result.
The authoring compiler keeps node identity in every derived binding.

Background composition derives its mask from the selected foreground:

```yaml
- key: maskArtifactId
  semanticType: artifact.mask
  sourcePolicy:
    allowed: [derived]
    default: derived
  derivation:
    kind: same_bundle_role
    fromParameter: foregroundArtifactId
    role: mask
    optional: true
```

After the foreground is selected, the compiler finds the mask on the same upstream
node and bundle. It leaves the mask empty only when `optional` permits it and never
searches another node for an arbitrary compatible mask.

## Collections and branches

- `artifact.image_list` is a bounded collection port, not an implicit collection of
  unrelated `artifact.image` values.
- Map items retain scope identity; authoring must not mix outputs across scopes.
- Mutually exclusive branches that produce the same semantic result use an explicit
  output selection or `$coalesce` projection before downstream use.
- Downstream nodes never infer which internal branch happened to produce a result.

## Declared and inferred semantics

Application projects current first-party semantics from reviewed capability profiles
and contract fields. The API marks a declaration `declared` or `inferred`. Inferred
compatibility exists for current built-in contracts; it is not a third-party extension
mechanism and must not silently widen authoring choices.

Semantic types support authoring and catalog projection. They do not replace runtime
facts such as MIME type, dimensions, alpha channel, data classification, or Artifact
availability. When required facts are unavailable, the UI reports uncertain
compatibility instead of assuming success.

## Verification

- Same-named outputs from different nodes remain distinct.
- An ordinary image cannot connect to `artifact.foreground`.
- Foreground and mask bind to the same source node and bundle.
- Branch normalization preserves explicit provenance.
- Map output does not mix bundle roles across scopes.
- Authoring blocks an incompatible type, and runtime still validates the real value.
- Normal UI does not expose Artifact IDs or internal bundle identity.
