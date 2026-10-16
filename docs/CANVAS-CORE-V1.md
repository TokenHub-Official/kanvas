# Canvas core v1

Canvas core is the baseline professional image-design workbench, not an editor-shaped
prototype. A designer can begin with an empty page, local images, or existing assets;
add and edit images, text, shapes, graphics, frames, and grids; invoke image tools;
save and recover the document; and export the visible result.

Its interaction grammar borrows proven conventions from Canva without pursuing a
pixel-for-pixel clone or every Canva media type. See
[PRODUCT-UI-ARCHITECTURE.md](PRODUCT-UI-ARCHITECTURE.md) for page ownership and
[PRODUCT-UI-EXPERIENCE-NORTH-STAR.md](PRODUCT-UI-EXPERIENCE-NORTH-STAR.md) for
long-term interface principles.

## Successful journey

```text
Create a Canvas
-> add an image, text, shape, or asset
-> manipulate, arrange, and layer content
-> use a background, brand resource, or image tool
-> save and recover after refresh
-> export an image matching the Canvas preview
```

This journey has no inert placeholder actions and does not require users to understand
internal concepts such as Artifact, Capability, Workflow, or model provider.

## Core model

```text
EditorDocument
├── Page
│   ├── PageBackground
│   ├── Guides / Safe Area / Bleed
│   └── EditorNode[]
├── Resource references
└── Command history
```

The following boundaries remain stable:

- A node type describes an object on the Canvas, not its source.
- Local uploads, asset references, and generated results are image sources, not
  separate node types.
- Uploading, processing, failed, and unavailable are node states, not node types.
- An image-processing tool is a command or operation, not a node.
- Pages, backgrounds, guides, selections, and comments are not ordinary content nodes.
- Nodes may extend beyond a page; the page is the preview and export clipping boundary.

## Node types

| Node          | Type-specific behavior                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `ImageNode`   | Aspect ratio, crop, focal point, flip, replace, adjustments, filters, shadow, masks, tool input   |
| `TextNode`    | Rich text, fonts, weight, size, leading, tracking, paragraph, stroke, shadow, curve, effect stack |
| `ShapeNode`   | Data-driven shape catalog, fill, stroke, parameters, handles, internal text                       |
| `LineNode`    | Independent endpoints, arrows, width, dashes, and path editing                                    |
| `GraphicNode` | Recolorable vector icons and illustrations, color slots, proportional scaling                     |
| `FrameNode`   | Image drop target, fill crop, focal movement, and content replacement                             |
| `GridNode`    | Multiple cells, gaps, radius, proportions, and independent image content                          |
| `GroupNode`   | Child structure, transforms, copy, layer changes, and ungrouping                                  |

Art text remains `TextNode + TextEffectStack + Preset`. It is not replaced by a
rasterized image or a partial standalone node.

All nodes support:

- single selection, multiselection, and marquee selection; group children are edited
  after ungrouping in v1;
- move, rotate, type-correct resize, and keyboard nudging;
- align, distribute, snap, and dynamic guides;
- layer ordering, layer drag, visibility, lock, and rename;
- copy, paste, duplicate, delete, group, and ungroup;
- opacity, context commands, shortcuts, Undo, and Redo;
- autosave, version recovery, and export matching the editor preview.

## Adding nodes and resolving content

A node can be added by:

1. Clicking a left-panel item to create it at the visible page center.
2. Dragging a left-panel item to the pointer location.
3. Dropping a local file onto the Canvas.
4. Pasting an image or text from the system clipboard.
5. Choosing a user, team, brand, or public-library asset.
6. Adding an image-tool result as a node or replacing the current node.
7. Copying an existing node or restoring one from a template.

Placement follows these rules:

- An image keeps its aspect ratio and initially fits a reasonable visible-page area.
- Multiple images are offset or laid out rather than perfectly overlapping.
- Dropping into a Frame or Grid cell fills that container.
- Setting a page background is an explicit action.
- A local image appears immediately through a Blob, uploads in the background, and
  switches to an immutable resource reference without changing node ID, position, or
  history.

Sources remain type-specific:

- Images: local files, clipboard, team and brand assets, licensed public resources,
  and generated results.
- Shapes: a versioned Shape Registry, not a small hard-coded list.
- Text: blank text, text styles, art-text presets, brand typography, and templates.
- Fonts: clearly licensed built-ins, system fonts, team fonts, and brand fonts.
- Graphics: safely parsed icons, illustrations, and SVG resources.
- Frames and grids: versioned built-in or team-published catalogs.

## Left-side capabilities

The left rail owns content discovery, import, and entry into complex capabilities. It
does not contain every property of the selected node.

| Entry      | Responsibility                                                         |
| ---------- | ---------------------------------------------------------------------- |
| Design     | Page and visual templates plus dynamically published production flows  |
| Assets     | Unified search for images, illustrations, icons, shapes, frames, grids |
| Text       | Headings, body text, styles, font catalog, brand fonts, art text       |
| Brand      | Logos, colors, fonts, images, and brand typography                     |
| Uploads    | Batch import, queue, progress, retry, duplicate handling, history      |
| Tools      | Crop/layout, segmentation/cleanup, enhancement, generation, Workflows  |
| Background | Transparent, color, gradient, or image background and its controls     |

A tool entry declares:

- allowed node input and count;
- parameter structure and defaults;
- Browser, Worker, or Provider execution and fallback;
- progress, cancellation, failure, retry, and cost feedback;
- whether output is a preview, new node, replacement-derived node, or Asset;
- source and result lineage, without destructive edits to the original.

Interaction ownership remains consistent:

- Direct manipulation: move, resize, rotate, crop, and edit text on Canvas.
- Fixed type toolbar: high-frequency type-specific and multiselection actions.
- Selection toolbar: one-click common actions such as lock, copy, delete, and More.
- Left rail: discover content and enter complex capabilities.
- Context menu: object organization and lower-frequency commands.
- Layer panel: opened when needed, not a permanent administrative sidebar.
- Top bar: file actions, Undo and Redo, share, and export.

## Constraints

- The editor targets controlled desktop browsers and professional designers, not
  mobile editing.
- Static image design is primary; video, audio, table, and chart nodes are excluded.
- Business scenarios such as posters, commerce ads, and social covers are not
  hard-coded into Canvas.
- A handful of handwritten shapes, fonts, or inert actions do not represent a catalog.
- Model, provider, Artifact, and Capability implementation details stay out of normal
  UI.
- The product does not use permanent dual property sidebars or a generic back-office
  form editor.
- Frequent transforms respond locally; remote execution remains cancellable,
  recoverable, and capable of governed fallback.
- Authentication, Asset, Draft, history, recovery, and export facts survive UI changes.
- Canvas implements this image-design core deeply; it does not attempt complete Canva
  parity.

## Verification

Deterministic command, document, store, renderer, and contract tests cover internal
behavior. One representative release journey with real assets verifies the visible
loop:

1. Create a multipage Canvas.
2. Add a local image, an Asset image, a catalog shape, normal text, and art text.
3. Add a Frame or Grid and drop an image into it.
4. Crop, arrange, snap to guides, reorder layers, group, edit beyond page bounds, and
   set a background.
5. Invoke a local tool. If the instance publishes an image production flow, invoke one
   with fallback; otherwise verify that an unavailable capability cannot execute.
6. Refresh and recover content and upload state.
7. Render PNG through the real path; deterministic renderer tests cover PNG, JPEG,
   WebP, size, transparency, and failure boundaries.
8. Save the result as an Asset and insert it again.

The browser journey is a final user-visible check, not a substitute for focused
contract, store, renderer, and component tests during development.
