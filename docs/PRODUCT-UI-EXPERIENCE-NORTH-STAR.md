# Product UI and interaction principles

These principles apply across public entry, Studio, Canvas, Workflow, Brand, Assets,
and Workspace administration in `apps/web`. Product scope comes from
[PROJECT.md](PROJECT.md) and [PRODUCT.md](../PRODUCT.md), visual language from
[DESIGN.md](../DESIGN.md), information architecture from
[PRODUCT-UI-ARCHITECTURE.md](PRODUCT-UI-ARCHITECTURE.md), and review practice from
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Responsibility

This document records product UI facts that remain valid across pages and tasks. It
defines product character, information hierarchy, component boundaries, interaction
feedback, and acceptance expectations. It does not record branch plans, migration
batches, completion percentages, or page-by-page development logs.

Business contracts, the current Router, and domain documents define each page's
objects, authority, state, and successful destination. Historical screenshots and
phase analysis do not become current product facts.

## Experience goals

Kanvas is a visual creative workspace, not a generic SaaS administration panel. The
interface is:

- **Creative**: work and creative objects take priority; tools serve content and
  dashboards do not dominate the first screen.
- **Rigorous**: authority, state, save, execution, version, and recovery come from
  authoritative facts rather than client guesses.
- **Intuitive**: object, state, and action hierarchy make the next step evident without
  implementation prose.

The unit of completion is a recoverable user task, not a number of replaced components
or a visual-consistency percentage.

## Page organization

Every page has one primary role: entry, triage, browse, edit, detail, recovery, or
administration. It makes explicit:

- the primary object;
- the decision the user needs to make now;
- current state and its source;
- one primary action;
- successful destination;
- recovery from the highest-risk failure, permission change, or refresh.

The first screen is not a table of contents. Explanations, statistics, secondary
lists, and shortcuts appear only when they can change the current decision. Show the
same information once, where it has the most decision value.

An object without a current product page does not remain in navigation, page lists, or
design baselines. A compatibility redirect migrates an old link; it is not a product
page.

## Information expression

- Use business names, not internal IDs, keys, provider routes, storage locations, raw
  exceptions, or implementation notes.
- Offer a default as configuration only when the user can understand and change the
  decision.
- Name a state for the user's situation and available action, not an internal enum.
- Place errors near the blocked task and field errors near their fields. Do not rely
  on a notification for a failure that still needs action.
- Empty states identify the next action; loading preserves task context; permission
  states provide a bounded exit or recovery.
- Counts, cost, availability, and completion state trace back to an explicit query or
  business projection.

## Spatial and visual hierarchy

- Artwork, Canvas, Asset preview, and current editing object take priority over page
  chrome.
- Containers represent a real business object or spatial layer; do not wrap every text
  block in a card.
- Continuous content uses spacing, surface contrast, and typography for hierarchy.
- Borders indicate a control outline, structural separation, or state boundary.
  Borderless does not mean imperceptible.
- Creative pages stay low-noise and content-first. Administration can be denser while
  sharing semantic tokens and component behavior with Studio.
- Avoid visual eyebrows, subtitles that explain the interface itself, and decorative
  statistics without decision value.

Desktop and narrow layouts keep the same task order. Responsive layout may change
columns, navigation container, and action arrangement, but not the primary object,
primary action, or recovery semantics.

## Implementation system

### Components and styles

- Ant Design is the baseline for general controls, feedback, overlays, and accessible
  behavior.
- Tailwind CSS owns page structure, layout, spacing, typography, responsive rules, and
  product-owned surfaces.
- CSS variables are the authority for design tokens and runtime themes; Tailwind and
  Ant Design consume one semantic system.
- Product adapters add only Kanvas business semantics, governed variants, or
  cross-component constraints.
- Complex Canvas geometry, rendering, and necessary motion may use local CSS.
  Feature-local third-party styles load with the lazy feature rather than globally.

Do not:

- add a direct Radix dependency;
- override `.ant-*` internals or depend on their child DOM structure;
- use Tailwind `!` overrides to fight Ant Design geometry, color, focus, or state;
- replace product interaction with browser `alert()`, `confirm()`, or unstyled native
  selection controls;
- copy base component behavior for one page when the system already provides it.

### Data entry and feedback

- Input, Password, TextArea, Select, and InputNumber use Ant Design's `filled` variant
  by default.
- Rest, hover, active, focus, and disabled states come from theme or component tokens.
- Pages customize through public props, `classNames`, `styles`, and controlled state.
- Notifications report transient completion. Persistent blocking, recovery, and
  validation feedback remains inside task context.

### Icons and illustrations

- Ant Design Icons cover basic actions.
- MIT-licensed Ant Design SVGs cover invitation, creation entry, blank Canvas and
  broken-link states; retain the upstream license alongside copied assets.
- An icon improves recognition or conveys an action, and one icon does not represent
  conflicting semantics.
- Decorative icons are hidden from assistive technology; interactive controls have a
  stable accessible name.

### Internationalization

- Every visible string, ARIA label, feedback message, state, and formatted value lives
  in JSON locale resources.
- Keys use business semantics rather than color, position, or component names.
- Default and longest supported languages keep the same task order; layout does not
  rely on one language's string length.

## Motion

Motion explains a state change, spatial relationship, or action result. It is short,
interruptible, and does not block input; hide loading, saving, or execution; or cause
unexplained jumps during list reordering, error display, or focus movement.

Under `prefers-reduced-motion`, disable nonessential translation, scaling, and looping
animation. Remove keyframes, old component variables, and motion that has no consumer.

## Accessibility and state completeness

Every relevant page verifies:

- one meaningful heading hierarchy;
- keyboard entry, operation, exit, and focus return;
- visible unclipped focus;
- state that does not rely only on color;
- text and state-color contrast;
- loading, empty, error, disabled, read-only, permission, and conflict recovery;
- narrow width, 200% zoom, longest locale, and reduced motion.

A browser screenshot proves only visible state at that moment. It does not replace
real data, authority, network, and recovery verification.

## Dependency and asset admission

A new UI dependency explains:

1. Why the current component system cannot express the requirement.
2. Whether it serves one route and can load lazily with that feature.
3. Bundle, CSS, runtime, Worker or CSP, and browser impact.
4. License, maintenance status, and exit path.
5. How its domain model or style system is prevented from becoming Kanvas authority.

A package mentioned in documentation is not necessarily adopted. `package.json`, the
lockfile, and a locatable production consumer together prove adoption. Remove a direct
dependency, code, styles, and assets when their last consumer is removed.

## Documentation lifecycle

- `DESIGN.md`: visual language and brand character.
- This document: cross-page experience and implementation principles.
- `PRODUCT-UI-ARCHITECTURE.md`: current information architecture, route ownership,
  and journeys.
- `CONTRIBUTING.md`: implementation, review, and verification conventions.
- Domain documents: business objects, contracts, state, and recovery.
- Git history and issues or pull requests: phase analysis and historical evidence.

Branch plans, page-by-page logs, completion checklists, and one-off TODOs do not enter
the long-lived documentation index. At task completion, update only conclusions that
remain valid across future work.
