# Editor node specification

Editor documents use `kanvas.editor-document/v1`.

## Boundary

An Editor Node represents Canvas content that participates in selection, layout,
layers, persistence, and export. The following are not nodes:

- **Page**: final dimensions and clipping boundary.
- **PageBackground**: transparent, paint, or image background.
- **Guide, Safe Area, and Bleed**: editing aids.
- **Selection, Hover, and Transform Handle**: transient renderer state.
- **Upload and Processing**: runtime state before durable content is available.
- **Tool**: an operation that reads a node and produces a command, derived node, or
  Artifact.

Local images, Assets, Artifacts, and generated results are sources for `ImageNode`;
they do not create persistent types such as `local_image` or `generated_image`.

## Node tree

`Page.nodes` is the back-to-front drawing order for top-level page content.
`GroupNode.children` uses the same rule in group-local coordinates.

The document does not maintain both a flat element array and a separate group-membership
table. The Command layer enforces integrity beyond bounded JSON shape:

- Node ID is unique within a document.
- Groups are acyclic and contain at least two nodes.
- A node appears in exactly one tree position.
- Frame and Grid image content does not also appear as a sibling layer.
- A page has at most 5,000 nodes, including recursive content.

## Common properties

Every node persists:

- `id` and `name`;
- `transform`: `x`, `y`, `width`, `height`, `rotation`, `flipX`, and `flipY`;
- `opacity` and `blendMode`;
- `visible` and `locked`;
- type-specific content.

Renderer instances, DOM or SVG references, object URLs, download URLs, selection,
hover, handle state, and upload progress are never persisted.

## Common commands

All nodes support select, move, resize, rotate, copy, duplicate, delete, opacity,
blend mode, layer, visibility, lock, rename, and group operations.

Every command:

- participates in Undo and Redo;
- validates authority, locked state, and node identity before commit;
- creates one history entry per direct manipulation;
- prevents UI code from mutating the persistent tree directly;
- leaves no partially changed node after failure.

## Type semantics

### Image

- Corner handles resize proportionally.
- An ordinary edge drag changes the container or enters crop rather than stretching
  source pixels.
- `fill` is an explicit exception, never the default.
- Crop, focal point, adjustments, filters, mask, and shadow are nondestructive.
- An image-tool result creates a derived Artifact; the user chooses insert or replace.

### Text

- Paragraphs and Runs preserve local font styles.
- Side handles change text-box width and reflow content.
- `auto_width`, `auto_height`, and `fixed` are distinct.
- Art text is an editable effect stack. Preset records provenance but never replaces
  effect parameters.
- Initial effects include outline, shadow, background, curve, glow, hollow, offset
  layers, and skew.

### Shape

- `definition` pins a versioned Shape Catalog entry rather than a contract enum.
- `parameters` contains editable values declared by that definition.
- Renderer consumes the definition's geometry, handles, and text-safe area.
- Fill, stroke, and internal label are edited independently.

### Line

- Lines use endpoint or path-point editing, not rectangular resize handles.
- Straight, polyline, elbow, and curve paths are supported.
- Start and end caps, stroke, and dash are persisted.

### Graphic

- Graphics are recolorable vector icons and illustrations.
- Their source is an immutable Artifact or versioned catalog resource.
- `colorSlots` may override only declared slots; UI never guesses arbitrary SVG colors.

### Frame

- A Frame contains one image.
- Dropping an image fills it without creating a sibling image node.
- Resizing the Frame does not stretch its image; crop and focal point recompute layout.

### Grid

- A Grid pins a versioned layout and contains multiple image slots.
- Each slot has independent replacement, crop, and focal point.
- Gap and corner radius belong to Grid, not copied slot state.

### Group

- Group is created from a selection and does not appear as an empty catalog item.
- Children use local coordinates and whole-group transforms apply to the group.
- Child editing in v1 follows ungrouping. Ungroup converts each transform back into
  parent coordinates while preserving visual position.

## Runtime and persistence

Durable documents accept only immutable Artifact or versioned catalog references.
Browser runtime may attach temporary local Blob or object URLs, authorized Artifact
read URLs, upload progress and errors, decoded images, loaded fonts, and renderer
caches.

A local-image transition preserves node ID and transform:

```text
local Blob
-> uploading
-> committed Artifact
-> durable ImageNode
```

Crash-recovery state may retain a File or Blob locally, but a document synchronized to
Server never contains a temporary URL.

## Version boundary

- The first public version accepts only `kanvas.editor-document/v1`.
- Document, Draft, Revision, API, and database constraints use the same schema.
- Shape, Frame, Grid, Graphic, Text, and Group pin catalog or node identity.
- An unknown schema version fails closed. Runtime does not guess or migrate
  development-era documents.

## Renderer contract

Renderer owns:

- node-tree drawing, hit testing, coordinate conversion, and page clipping;
- direct-manipulation preview, handles, snapping, and guides;
- runtime resolution of fonts, images, and catalog definitions.

Renderer does not:

- generate business IDs;
- decide Artifact or Asset lineage;
- bypass commands to mutate the document;
- persist temporary URLs;
- silently rasterize an unsupported node over its source content.
