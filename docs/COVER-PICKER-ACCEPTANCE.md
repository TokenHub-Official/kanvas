# Unified cover picker — local acceptance (2026-09-24)

## Shipped behavior

Skills and site tools use `CoverPickerDialog` with Ant Design Modal, Input, Upload and Button. Browse/search/upload/select/remove are local dialog operations. Confirmation updates the resource form only; saving that form changes its cover reference. Cancelling or failed upload preserves the previous form value.

Skills uses workspace asset.read for browsing and asset.write for upload, through existing user-import allocate → binary PUT → commit. A successful upload creates an explicit workspace Asset, available independently of its use as a cover; its retention follows the existing asset lifecycle. Site tools use instance-administrator authorization and site-owned upload sessions, never a synthetic workspace or a private workspace asset reference. Both uploaders retain session identity on same-file retries.

New site covers use the existing StoragePort/profile/object-store adapters. Original image content is decoded, stripped and normalized before sealed object storage; site_tool_image stores identity/size/hash, with NULL inline bytes. Legacy inline PNGs and logo uploads remain compatible. No avatar/Logo chooser component was modified by this goal.

## Retention and authority

- Site image upload sessions bind instance and uploader. Allocation, upload claiming, verification, commit and reference save revalidate authority.
- Failed upload leases release only with the current token; retry checks and reuses an already-written object.
- Site images continuously observed without a nondeleted tool reference are retained for at least 24h before retirement. Disabled tools also protect references; shared images remain while any nondeleted tool references them.
- Cleanup and tool mutation use the same instance row lock. Retirement prevents future selection, reads and references before deleting the exact stored object. Deletion retries keep a durable cleanup lease. Expired uncommitted uploads also clean up.
- Workspace uploads intentionally become Assets; cancelling a cover dialog does not delete an asset-library item.

## Evidence

| Requirement                                               | Verification                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site upload, cancel, search, select, save, reopen, remove | Actual browser dedicated tool `[redacted-resource-id]`; cancellation left Save disabled; saved cover was selected after reopening; confirmed removal saved                                                    |
| Skills upload, select, save, reopen, remove               | Actual browser dedicated draft `[redacted-resource-id]`; uploaded image rendered, saved, removed, reopened, then restored from library                                                                        |
| Failure recovery                                          | Invalid PNG rejected on both real pages with localized actionable copy; subsequent existing-image selection and save succeeded                                                                                |
| Real object storage                                       | Local DB readback for `cover-acceptance-0924.jpg`: object_backed=1, 960×640, 2882 normalized bytes; no inline bytes                                                                                           |
| Stored object write/read and failure recovery             | `apps/server/test/site-cover.service.test.ts`: actual local StoragePort, JPEG normalization/sealing/readback; post-write verification failure retries without another write; scheduled cleanup deletes object |
| Scope, races and retention                                | `packages/database/test/site-cover-store.integration.test.ts`: cross-instance/uploader denial, revoked admin, replay, current-token release, shared/disabled references, unreferenced grace and retirement    |
| Legacy images and user access                             | Existing `site-tool-lifecycle.integration.test.ts` passed with new schema and image-read paths                                                                                                                |
| Retry identity                                            | Workspace and site cover uploader tests prove failed commit does not allocate or upload again                                                                                                                 |
| UI consistency                                            | Independent reviewer examined `.tmp/cover-picker/picker-desktop.png` and `picker-mobile.png`; no blocking desktop/390px design issue                                                                          |
| Build and contracts                                       | Server/web type checks, scoped ESLint, generated OpenAPI/browser types and web production build pass; existing bundle-size warning remains                                                                    |

Migrations 0009 and 0010 were first tested in disposable databases, then applied only to the guarded local development database. No deployment, push or paid model execution occurred. Browser tests used dedicated records and left real user records unchanged. Original user editing tabs were not refreshed; separate verification tabs were used.

## Scope limits

No cross-workspace copying, site-library manual deletion UI, or unified avatar chooser is introduced. These are outside this goal. Site upload is bounded to the existing 2 MiB image input budget; normalization keeps safe PNG output within 512 KiB by automatic proportional resizing. Selected cover files are not executable HTML tool documents.
