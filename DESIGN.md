---
name: Kanvas
description: A precise, artifact-first design language for professional visual production.
colors:
  primary: "#3048F5"
  primary-deep: "#2237D8"
  focus-ring: "#3048F5"
  focus-halo: "#D4FF4F"
  paper: "#FFFFFF"
  mist: "#F1F0FA"
  mist-deep: "#E7E5F1"
  ink: "#151515"
  muted: "#6B6A73"
  line: "#DEDCE8"
  canvas: "#17181D"
  canvas-soft: "#222329"
  positive: "#18795B"
  warning: "#9A5C07"
  danger: "#C33B32"
  artwork-coral: "#FF7165"
  artwork-aqua: "#5CD8C1"
  artwork-violet: "#9C86FF"
typography:
  display:
    fontFamily: "SF Pro Display, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "SF Pro Display, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "SF Pro Text, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "SF Pro Text, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "SF Pro Text, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  control: "12px"
  card: "16px"
  dialog: "22px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "42px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "24px"
---

# Kanvas design system

## Creative north star

**The Digital Proofing Studio**

Kanvas takes its visual language from a professional digital proofing studio: calm,
clear, and trustworthy, with the work itself carrying the greatest visual weight.
Precise typography, state, and actions help designers deliver. Creative energy does
not come from the purple gradients, neon glow, and magic buttons common to AI products.

This file defines stable visual foundations only. It does not prescribe a page layout,
information order, interaction, or business flow. Design each page from its information
architecture, user journey, authority, server facts, recovery needs, and working
density. See
[Product UI principles](docs/PRODUCT-UI-EXPERIENCE-NORTH-STAR.md) and
[Product UI architecture](docs/PRODUCT-UI-ARCHITECTURE.md).

### Creative, rigorous, intuitive

- **Creative** comes from artwork priority, spatial composition, direct manipulation,
  and meaningful motion, not decorative copy, eyebrows, colored cards, or extra chrome.
- **Rigorous** comes from accurate state, stable components, explicit actions, and
  recoverable errors, not implementation prose placed in the UI.
- **Intuitive** means objects, state, and the next action are understandable without a
  tutorial paragraph. When explanation is necessary, first reconsider hierarchy,
  labels, placement, and feedback.

When these goals conflict, intuitive use wins over visual expression, and rigor
protects real consequences and recovery. Rigor is not permission to add more
explanation, containers, or steps.

Key characteristics:

- Work first, interface second, with critical state always clear.
- Paper and light mist for everyday work; graphite only for visual inspection and
  focused production.
- Cobalt as the only primary brand and action color; Signal Acid only for focus and
  immediate attention.
- Restrained radius, thin boundaries, and sparse ambient shadow rather than a card wall.
- Professional desktop density with keyboard access, recovery, and high state
  transparency.

## Color

The palette is a quiet studio-neutral system with one clear action color. Creative
colors belong to work and visual examples.

- **Kanvas Cobalt**: primary actions, brand identity, selection boundaries, and key
  links.
- **Deep Cobalt**: hover or pressed state for a primary action, not a second brand
  color.
- **Signal Acid**: keyboard focus, current step, or rare immediate-attention state.
- **Artwork Coral, Aqua, and Violet**: thumbnails, examples, illustration, and content
  preview only.
- **Paper**: forms, overlays, dialogs, and primary light surfaces.
- **Studio Mist and Deep Mist**: application background, grouped areas, and rest state.
- **Proofing Ink**: primary text and high-contrast structure.
- **Muted Ink**: secondary text and metadata while retaining WCAG 2.2 AA contrast.
- **Hairline**: inputs, dividers, and quiet boundaries.
- **Inspection Canvas and Canvas Soft**: color judgment, transparency inspection, and
  focused creation.

Named rules:

- **80/15/5**: neutral surfaces carry roughly 80% of visual weight, Cobalt roughly 15%,
  and Signal Acid no more than 5%. This is a composition constraint, not pixel math.
- **Artwork color**: Coral, Aqua, and Violet are content colors, never routine product
  chrome.
- **Dark Canvas**: dark surfaces surround work that needs color or transparency
  judgment. They do not turn the entire product into developer-tool dark mode.

## Typography

The current baseline uses browser-deliverable system families: SF Pro Display for
display text, SF Pro Text for body text, and PingFang SC, Microsoft YaHei, and
`system-ui` fallbacks. Do not claim a self-hosted typeface until licensed files ship
with the repository. Weight creates hierarchy; avoid excessive uppercase, ultra-light
weights, and decorative families.

- **Display**: 700, 32px, 1.15. Product-level or substantial empty-state title, not a
  routine panel.
- **Headline**: 700, 24px, 1.25. Page or primary-task title.
- **Title**: 700, 16px, 1.35. Component, group, or important object name.
- **Body**: 400, 14px, 1.6. Description, form, and feedback; long text is about 70ch.
- **Label**: 700, 12px, 1.4. Controls, metadata, and compact status. Product text never
  falls below 12px.

**Professional density**: page titles are normally 24–32px, body text 14–15px, and
metadata at least 12px. Smaller type is not a solution for excess information.

## Content and hierarchy

By default, show the current object, current state, and next action. Keep explanation
only when it helps a decision, prevents loss, or explains recovery. Present one fact
once, where it has the highest decision value.

- **Zero eyebrow**: no visual eyebrow above a title, including uppercase labels,
  decorative numbers, generic categories, slogans, Workspace names, or tiny
  explanations. Put real scope, state, and ownership in the title row or object
  metadata.
- **Intuition before explanation**: remove prose that describes the interface, repeats
  a title, or explains an obvious action. Keep the shortest necessary fact only for an
  unexpected consequence, irreversible change, permission or cost change, or recovery.
- **No redundant feedback**: when direct manipulation has an obvious visible result,
  do not add a persistent “updated” or “applied” message. Use feedback when the result
  is invisible, delayed, uncertain, or failed.
- **Evidence-only metadata**: show dimensions, count, time, version, owner, and state
  only when they affect the current decision.
- **Container test**: every border, background, card, panel, and separator represents a
  real object, operable unit, or spatial layer. Remove it when meaning survives without
  it.
- **Deletion pass**: before visual review, try removing eyebrows, explanations,
  repeated titles, secondary actions, badges, metadata, containers, and separators.
  Restore only what protects judgment, action, risk recognition, or recovery.
- **Badge budget**: emphasize one current state per object. Pills are for state,
  filters, and classification, not file format, dimensions, time, or role prose.
- **User language**: normal designer journeys do not expose permission codes, database
  entities, upload sessions, providers, capabilities, or workflow internals.

## Layout

Use a 4px base rhythm with common spacing of 8, 12, 16, 24, 32, and 48px. Layout follows
the user journey rather than a global three-column, inspector, or dashboard template.

Studio gives artwork, source material, or the current deliverable space before tools
and explanation. Administration may be denser while sharing semantic tokens and
navigation structure. Full production targets desktop widths at and above 1280px;
narrow desktops retain primary action, recovery, and exit paths.

- **Journey before grid**: establish the user's decision, next action, and recovery
  before choosing a grid.
- **One primary action**: one decision region has one visually primary action; put
  alternatives in secondary, quiet, or menu treatments.

## Depth and shape

Tone and hairlines create most layering. Static pages do not use broad shadows as card
hierarchy. Overlays, menus, dragged objects, and dialogs use soft ambient shadow and
only necessary backdrop blur.

- **Ambient Floating**: `0 18px 55px rgba(32, 29, 52, 0.13)` for dialogs and important
  overlays.
- **Inspection Lift**: `0 28px 70px rgba(0, 0, 0, 0.36)` only for artwork in a dark
  inspection environment.
- **Flat by default**: shadow communicates a real floating, dragging, or Canvas
  relationship.

Controls use a 12px radius, content cards 16px, and dialogs 22px. Pills are reserved
for short state, filters, and avatars. Boundaries are normally a 1px Hairline; selected
objects may use a 2px Cobalt boundary without also adding heavy shadow and saturated
fill.

## Motion

Motion explains entry, state, and spatial relationship without making every module a
performance.

- Routine control states: 150–180ms.
- Artwork scale, lift, and label movement: 240–340ms with
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- Initial page entry: at most 360ms with content visible by default.
- Continuous loops: only for genuine running, loading, or waiting state.

Keep one authored motion moment per page. Other hover and state transitions provide
feedback. Do not transition width, height, margin, or padding; prefer transform,
opacity, filter, or a real progress value. Disable nonessential motion under
`prefers-reduced-motion`.

Keyboard focus uses a visible 3px Cobalt inner ring with a Signal Acid outer halo. A
low-contrast transparent outline is not an accessible focus treatment.

## Iconography

Use `@ant-design/icons` for actions, navigation and state. Entry and empty-state
symbols use selected MIT-licensed Ant Design SVGs from `assets/icons/ant-design`.
Keep the upstream license with copied assets. A compact toolbar uses one base style.

- Navigation and compact actions: 16–20px icons. Pair unfamiliar actions with text
  and provide a Tooltip for icon-only controls.
- State and feedback: semantic color and text; state never relies on color alone.
- Entry and empty-state symbols: larger decorative icons with explanatory text.

Preserve each asset's original `viewBox`. CSS masks use `contain` and current text
color, without stretching the artwork. Preserve semantic mappings when replacing
an icon; do not reuse one symbol for conflicting actions.

## Implementation contract

Components define visual and interaction semantics, not page composition. Ant Design
supplies common controls through the Kanvas theme and component tokens. Existing
Radix-based boundaries remain only until migrated; do not add direct Radix
dependencies.

### Tailwind first

Use Tailwind for page layout, spacing, dimensions, typography, responsive rules, and
local state styles. Use standalone CSS only for:

- design tokens, fonts, and cross-page foundations;
- keyframes, complex pseudo-elements, or browser capability adaptation;
- Canvas and image-inspection visuals too complex for clear utility classes;
- third-party customization through component tokens or public `className`,
  `classNames`, and `styles` APIs.

Never target guessed third-party internals with tag position, `.ant-*`, `> span`, or
`nth-child`. Give product-owned elements explicit classes or direct utilities.

Tailwind-first does not authorize fighting third-party geometry. Do not use Tailwind
`!` modifiers on Ant Design semantic nodes to force height, padding, radius, color,
border, focus, or internal layout. Use public `size`, `variant`, Theme, Component Token,
or semantic `styles`; otherwise add a product adapter or choose a more suitable
component.

### Internationalization

Every user-visible string goes through product i18n: headings, buttons, placeholders,
tooltips, ARIA labels, notifications, errors, empty states, and confirmation copy.

- Add keys for every supported locale in the same change.
- Ant Design locale, product-copy locale, and date/number locale come from one state.
- Use `Intl` or shared formatters for date, number, money, percentage, and relative
  time.
- Check the default locale and the supported locale with the greatest text expansion.
- Do not hard-code visible copy in routes, pages, or business components.

### Ant Design authority

Before adopting or migrating a component, query the repository-pinned version through
`@ant-design/cli` for `info`, `doc`, `demo`, `token`, and `semantic`. Run `antd:usage`,
`antd:lint`, and `antd:doctor` after implementation. Kanvas owns product journey and
visual language; current Ant Design documentation owns supported APIs, tokens,
semantic structure, and deprecations.

## Component behavior

- **Buttons**: 12px radius and 40px normal height. Primary uses Cobalt and Paper;
  Secondary uses Paper, Hairline, and Ink; Quiet gains a light Mist hover surface.
  Destructive remains low-emphasis until final confirmation.
- **Chips**: short filters, state, or classification only. Selection uses Cobalt
  boundary or Ink contrast; Signal Acid remains a focus signal.
- **Cards**: Paper or Mist, 16px radius, optional Hairline. Use only for an independent
  object, whole-card action, or necessary surface separation.
- **Fields**: Paper, Hairline, and 12px radius. Focus combines Cobalt and Signal Acid;
  Error includes stable text rather than red alone. Use Ant Design and product adapters
  for Select, Combobox, Dialog, Popover, Notification, Tooltip, Menu, and Alert Dialog.
- **Navigation**: stable objects and frequent journeys only. Active state combines
  position, weight or shape, and color. Administration remains separate from Studio.
- **Canvas editor**: the document bar remains stable, type-specific tools stay at the
  Canvas top edge, and selection-local controls contain only common quick actions.
  Direct manipulation owns rotate, resize, crop, and text edit. The left content panel
  progresses from home to category or search to detail.
- **Feedback**: inline notices stay with a blocked context; notifications report
  transient nonblocking outcomes; alert dialogs confirm irreversible or high-risk
  actions. Never use browser `alert()`, `confirm()`, or unstyled native selection as
  final product interaction.

## Page delivery gate

- [ ] Zero Eyebrow, Intuition Before Explanation, and Deletion Pass completed.
- [ ] Tailwind owns page and local styling; CSS does not guess third-party DOM.
- [ ] Every visible string is localized and all supported locale keys exist.
- [ ] Ant Design APIs, tokens, semantic DOM, and deprecations checked for the pinned
      version.
- [ ] No Tailwind `!` geometry override on Ant Design and no page CSS targets internals.
- [ ] Loading, Empty, Error, Permission, Conflict, and Recovery states are covered.
- [ ] Keyboard, focus, screen-reader semantics, and reduced motion work.
- [ ] Target desktop, narrow desktop, and at least one mobile viewport are checked in a
      real browser.
- [ ] Type check, targeted lint, Ant Design lint, and production build pass.
