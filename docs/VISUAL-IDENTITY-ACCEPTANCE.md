# Visual identity acceptance

## Scope and implementation

Agent avatars and tool icons share `VisualIdentitySymbol`, `VisualIdentityMark`, `VisualIdentityPicker`, image cropping, and `VisualIdentityModal`. Agent uploads use workspace imports; tool uploads use site image storage. Tool presentation stores Unicode/icon/color in nullable `symbol`, mutually exclusive with `logoImageId` (migration `0011_tool_visual_identity.sql`). Brand Logos select existing Assets and retain their original Artifact and aspect ratio.

Fluent 3D is pinned to `@lobehub/fluent-emoji-3d` 1.1.0. Preparation copies local WebP assets and upstream MIT notices into the web public directory. The Unicode lookup preserves skin-tone/ZWJ sequences and ignores optional presentation selectors. Loading failures and unavailable emoji show native Unicode. The picker, preview, and saved marks use the same renderer.

## Verified browser journeys

Using the existing Chrome extension session, before leaving the database-accessible environment:

- Agent avatar acceptance fixture (`[redacted-resource-id]`): Chinese emoji search, Fluent cat with aqua background, actual create/save, detail rendering and edit readback. Image path: invalid PNG rejection, replacement with valid 640×320 PNG, right-side square crop, workspace upload, save, refresh and image readback. Canceling a subsequent emoji edit retained the saved image.
- Tool icon acceptance fixture (`[redacted-resource-id]`, slug `identity-qa-0924`): Fluent heart/pink background selection, apply, save, reopen, publish, consumer list and header display. Uploaded-image crop and save, canceling a symbol change, then saving a cat icon with dark background/white foreground and reopening were verified.
- 390×844 avatar modal: bounded scrolling, visible footer actions, no horizontal emoji-grid overflow. Viewport override was reset.

The image-avatar journey exposed an existing SQL bug: MIME validation queried `artifact.media_type`; it now joins the active `stored_object` and reads its `media_type`. Retrying the preserved browser draft then saved successfully. A disposable MySQL regression checks missing-image rejection through this query.

After database access became unavailable, a local fixture mounted the actual Brand Logo picker, ArtifactPreview, FluentEmoji and production theme. Only its HTTP responses were simulated:

- Initial asset-list HTTP 503 -> Reload images -> usable list.
- Corrupt preview bytes -> unavailable placeholder -> Retry preview -> valid image, selection preserved.
- Original preview dimensions 640×320 with `object-fit: contain`; no square crop.
- Empty search retained its input and previous selection; cancel did not apply it; reopening cleared temporary selection; Apply returned the original Asset/Artifact identity.
- Deliberate Fluent image HTTP 404 -> native hedgehog text with no broken image element.
- Preview mark center measured at zero horizontal and vertical offset after the alignment fix.

Screenshots and fixture source are retained under `.tmp/visual-identity/`. Fixture entry/config files were removed from the app before production build.

## Checks

- Web production build: passed (runtime assets preparation, TypeScript, Vite).
- Contracts, Database and Server TypeScript builds: passed.
- Web focused tests: 19 passed across Fluent lookup, avatar catalog/crop, ArtifactPreview, and Brand page boundaries.
- Contract focused tests: 7 passed.
- Disposable MySQL: 10 tool lifecycle tests and 10 Agent foundation tests passed during implementation, covering semantic persistence and image-avatar validation.
- Scoped ESLint and `git diff --check`: passed.
- 3,386 unique Fluent files in production output compared byte-for-byte with the pinned package; both license notices present.
- Vite retains a large-chunk warning, including the lazily loaded bilingual emoji catalogue. No build errors.

## Environment and delivery boundaries

No production deployment or production migration was performed. Migration 0011 was applied only to the then-confirmed local development database (`127.0.0.1:3306`, `kanvas_rollout_v1_3948160a`). The later network change was not treated as a business defect. Brand database save was not revalidated after that change; the changed selection/recovery UI was verified with the database-independent fixture, while Agent/tool persistence had already been verified online and in disposable MySQL.

The named QA Agent and tool are local test records. The tool was published solely in local development for consumer-view verification. A local logo selection acceptance draft brand was also created and was not published. They were not deleted after the network change.

## Grid redesign after user review (2026-09-25)

The earlier compact-row iteration is superseded. The image/Logo selector now uses one responsive grid: four desktop columns, three at 560px, two at 390px. Cards keep their size for sparse results. No persistent duplicate preview panel remains. Magnify is independent of selection; its temporary preview offers light/dark backgrounds. A single body scrolls, search stays available and footer actions stay outside the scroll region. Phone footer actions remain grouped on one line below the selected-name summary.

Avatar and tool icon editors share the frameless live preview, dense grids and appearance controls before the catalogue. Emoji search/categories stay sticky, results append in batches of 80, and hidden selection can be located. Icon grids no longer introduce an inner scroll container. Agent image Apply also respects upload permission changes. Re-selecting the original tool symbol does not create a redundant Apply action.

Brand Logo and reference-image selection now use the shared Asset dialog through `features/brand/brand-logo-picker.tsx`. The adapter owns server search, cursor pagination (48 per page), deduplication, actual ArtifactPreview rendering and a fresh Asset detail check before applying. Stale/deleted/inaccessible Assets cannot silently enter the form. Failed validation retains the dialog for another choice.

### New Chrome checks

These checks used the existing Chrome extension session and production components with explicitly simulated API responses. They are UI/adapter evidence, not a new online Brand-save proof.

- 0/1/3/12/60 Assets: empty state, natural one-row height, consistent card sizes, long names, landscape/portrait/transparent marks, four/three/two-column layouts.
- Pagination failure retained 48 cards; retry appended to 60; item 60 applied.
- An existing item 60 appeared immediately beside the first page, checked, without requiring all pages; unchanged Apply was disabled.
- Empty search preserved the tentative selection; Locate restored its result.
- Actual Brand adapter: list HTTP 503 retried to a usable list; corrupt image bytes showed per-card Retry preview. Retrying one card repaired it without selecting it.
- Actual Brand adapter: detail HTTP 404 retained the dialog with a localized error; choosing another Asset then applied successfully.
- Magnify did not select; Escape closed only the preview, preserving the picker.
- Permission change after selection displayed the reason and disabled Apply.
- Agent: search miss/Locate, background Apply and reopen, Cancel preserving the applied background; desktop and phone layouts with visible confirmation actions.
- Tool: cat icon plus dark background/white foreground, Apply and reopen; shared grid alignment and initial disabled Apply.
- Agent image: valid local test image, right-side crop, simulated upload HTTP 503; file and crop remained available for retry, outer Apply stayed disabled.

The reusable development-only scenario entry is now `apps/web/dev/visual-selectors.html` with its source and instructions alongside it. It intercepts all API requests locally, is not imported by the application and is not a production build entry. Screenshots are in `.tmp/visual-selector-design/`: `assets-12-desktop.png`, `assets-mobile.png`, `assets-1.png`, `assets-3-medium.png`, `assets-empty.png`, `avatar-desktop.png`, `avatar-mobile.png`, and `tool-icon.png`.

### Final checks for the redesign

- Web TypeScript: passed after removing the temporary source entry.
- Focused tests: 21 passed across avatar crop/catalogue, Fluent lookup, ArtifactPreview, Brand boundaries and tool API.
- Scoped ESLint: passed for changed production components/adapters.
- Production Vite build: passed; existing large-chunk warning remains, including the lazy bilingual emoji catalogue. Runtime preparation generated 3,386 assets.
- Git whitespace check: passed. No commit, push, production deployment or database mutation was performed during this redesign.

Database connectivity remains outside this verification. Previous online Agent/tool persistence evidence above remains historical; Brand persistence after this network change is not claimed as verified.

## Connected-environment revalidation (2026-09-27)

The user restored intranet access and authorized verification followed by commit/push.
Using the existing Chrome login and the actual local API (no fixture interceptors),
with the existing local database `127.0.0.1:3306/kanvas_rollout_v1_3948160a`:

- Agent avatar acceptance fixture: existing uploaded avatar read successfully; changed to
  cat icon, dark background and white foreground, saved, reloaded and reopened.
  All three selected values persisted.
- Brand logo selection acceptance draft: loaded the real image grid, selected existing
  test Asset `cover-acceptance-0924.jpg` (`[redacted-resource-id]`), applied,
  saved the draft, refreshed and reopened. Logo name/image and linked Asset returned.
  The brand remains unpublished. This closes the previous offline Brand-save gap.
- Tool icon acceptance fixture: changed to Fluent cat with aqua background, applied,
  saved, reloaded and reopened. Emoji and background persisted. No HTML or
  capability publication was needed for this presentation-only change.
- Fresh disposable MySQL run: 20 tests passed (Agent foundation and tool lifecycle).
- Fresh Web tests: 21 passed; contracts tests: 7 passed.
- Production build and Web/Server/Database/Contracts TypeScript passed. Scoped
  production ESLint passed. Development fixture now has its own tsconfig and
  passes TypeScript/ESLint too. Existing bundle-size warning remains.

Evidence: `.tmp/visual-selector-design/agent-online.png`, `brand-online.png`,
`tool-online.png`, `mysql-online.log`, and `build-online.log`.
These are local development results; no production deployment is implied.
