# Visual selector redesign

Status: implemented after scenario review; Brand adapter and Agent/tool shared controls integrated. See VISUAL-IDENTITY-ACCEPTANCE.md for evidence and the offline database boundary.

## Two tasks

- Avatar/icon editor: choose emoji/icon/image, adjust appearance, inspect one frameless live mark, apply a draft to the owning form. Fluent rendering is consistent throughout.
- Visual Asset picker: browse a responsive thumbnail grid and choose an existing image/Logo. Card preview preserves the whole original image. An explicit magnify action opens a temporary preview; no persistent duplicate panel.

## Layout rules

The Asset dialog is at most 720px wide. Its grid uses four columns when the content fits, three at intermediate widths and two on phones. Thumbnail ratio is 4:3 with contain fitting and a subtle transparency surface. Names occupy at most two lines; full names remain accessible through the selection label and preview title. Cards keep their regular width with 1–3 items. The dialog follows actual rows up to the viewport limit, without a tall empty panel.

Search/optional source actions are sticky at the top of the single scrolling body. Selection summary and Cancel/Apply remain outside scrolling content. Grid cards have explicit checked and keyboard-focus states. The magnify and retry controls are separate interactive actions and never apply a selection. Touch targets remain usable without hover.

## Selection state

Opening starts an isolated draft from the current value. Card selection changes only that draft. Apply calls the business adapter; only successful validation/confirmation closes the dialog. Cancel, close and Escape discard the draft. An in-flight confirmation is protected from duplicate submission. A failure retains selection/query and displays a recoverable message.

Search/source changes retain selection. If the selected item is outside the results, the footer identifies it and offers Locate selected. Locating clears the filter and reveals the known item without downloading every page. Initially selected items can be pinned into the first visible grid without duplicates.

Availability is explicit. Unavailable cards remain identifiable but cannot be selected. A refreshed unavailable selected item disables Apply with its reason. The adapter revalidates the selected Asset immediately before applying so permission loss/deletion is handled even when the item is filtered out.

## Loading and recovery

- Initial load: grid-shaped skeletons.
- Empty collection: short empty state and caller-provided upload action if authorized.
- Empty search: keep query, clear-search action; preserve selected summary.
- Collection failure: retry in context. Existing loaded items remain visible.
- Pagination: explicit Load more, appends and deduplicates results; a failed next page keeps earlier pages and retries at the end.
- Thumbnail/network/decode failure: original card stays in place with Retry; unaffected cards stay usable.
- Upload failure: business adapter retains the previous selection and valid draft; retry/replace/cancel stay clear.
- Long names, horizontal/vertical/transparent assets and disabled items keep stable card geometry.

## Shared boundary

A visual option has stable identity, display name, thumbnail, expanded preview and optional unavailability reason. A source supplies query/results/loading/retry/pagination state; it does not store the applied business value. Domain wrappers map actual Assets/site images/semantic marks, permissions and persistence. Do not rasterize Unicode or apply avatar cropping to brand Logos.

## Required scenario matrix

Use the real shared components and the production theme. Fixture data must be marked as fixtures. Verify 0, 1, 3, 12 and 60 items; first-load skeleton, search miss, first request failure, thumbnail failure, next-page failure, upload failure, long names, transparent/horizontal/vertical artwork, current selection outside results, invalidated selection and permission denial. Inspect desktop/intermediate/390px layouts and keyboard selection, preview closing/focus return, cancel/apply/reopen. Only then replace the production adapters for Agent avatars, tool icons and brand Logos. Document database/network boundaries separately from component behavior.
