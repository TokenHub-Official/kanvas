# Local designer review input

The designer review packet generator reads `source-selection.json` from this
folder. This file is local-only and is excluded from version control and public
exports because it identifies workspace artifacts and object-storage locations.

Prepare it using your own authorized test workspace. The required shape and
validation are defined by `SourceSelection` and `parseSelection` in
`tools/image-atomic-eval/scripts/generate-designer-review-packet.ts`. Do not commit
real resource IDs, storage paths, user materials, or generated review packets.
