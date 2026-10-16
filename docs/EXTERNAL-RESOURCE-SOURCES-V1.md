# External resource sources

This document defines the control plane, normalized candidate, and adoption boundary
for external images, vectors, fonts, and art-text resources. See
[STORAGE-AND-UPLOADS.md](STORAGE-AND-UPLOADS.md) for Storage and Artifact commits.

## Invariants

1. A provider URL, temporary download URL, or mutable catalog record never becomes a
   durable Canvas reference.
2. An adapter normalizes external content into a candidate before download,
   validation, and internal Revision or Artifact commit.
3. Adding external content to Canvas creates a provenance-bearing Artifact. A
   Workspace Asset is created only after the user explicitly saves it to the library.
4. Credentials, arbitrary headers, raw provider payloads, and internal IDs do not enter
   candidates or ordinary UI.
5. Source deactivation, upstream deletion, or changed license metadata does not mutate
   an adopted internal fact.
6. Kanvas does not bypass source terms, attribution, caching, redistribution, or
   commercial-use restrictions.

## Source types and instances

`ResourceSourceType` is an adapter descriptor from code or a trusted plugin. It
defines:

- a stable type key and supported resource kinds;
- authentication method, allowed origins, and network policy;
- configuration schema, license abilities, and adapter version;
- search, detail, and adoption abilities.

`ResourceSourceInstance` is a Workspace-administrator configuration. It pins source
type, public configuration, credential reference, license allowlist, and lifecycle.
Only a verified published instance enters the user catalog; draft edits do not change
the published Revision.

Source Instance lifecycle is separate from SecretVersion lifecycle. Credential
rotation does not rewrite Source Revision. Revocation or deactivation prevents new
queries and adoption without damaging historical Artifacts.

## Adapter boundary

Two adapter shapes are supported:

- **Declarative HTTP catalog adapter** for sources expressible through restricted
  requests, field mappings, and pagination.
- **Trusted native adapter** for signatures, OAuth, complex protocols, or code-level
  validation.

This is not a platform for user-supplied scripts, JSONPath, or arbitrary headers. Every
network request applies pinned origin, redirect, DNS, response-size, and media-type
checks, then projects the response into a normalized candidate.

## Normalized candidates

A candidate is a short-lived search result, not an internal Asset. Common fields are:

- source type, instance, and Revision;
- provider resource identity and stable detail reference;
- title, preview, resource kind, and known content summary;
- creator, source URL, license, and attribution;
- downloadable representation and required adoption parameters;
- expiry and adapter-evidence digest.

A candidate never carries a secret, internal storage key, unvalidated HTML or SVG,
executable code, or permanently trusted file metadata.

## Images and vectors

Adoption re-reads current Source Revision and authority, downloads through restricted
transport, and performs:

1. Size, MIME, magic-byte, dimension, and decode-limit validation.
2. Download-origin and redirect validation.
3. Removal of active SVG content, external references, scripts, and dangerous nodes.
4. Pinning of content hash, source, creator, license, and attribution.
5. Atomic StoredObject and Artifact commit.

Canvas references the internal Artifact. If the user later saves it to the asset
library, Asset adopts the same Artifact without a second download or loss of
provenance.

## Fonts

A font candidate pins family, style, weight, subset, format, file version, and license.
Adoption creates an internal Font Revision, which Canvas documents pin.

Font files are validated for container format, name tables, glyph limits, and content
hash. A floating CSS URL, `latest` version, or dynamic upstream family cannot enter a
published Brand or Canvas.

## Art text

Art text remains editable text. Pure styling uses restricted JSON presets; styling
that requires decoration uses a restricted bundle containing a manifest, preview, and
sanitized decoration resources.

Preview is not authority. Fonts pin Font Revisions and decorations reference internal
Artifacts; a raster preview is never presented as editable text.

## Licenses and obligations

A license descriptor separates license identity; commercial, modification,
attribution, and redistribution constraints; source-terms version; and human-review
requirements. Unknown or disallowed licenses fail closed.

Required attribution becomes Artifact provenance and is projected at export or
delivery when necessary. An adapter declaration does not replace legal review of
source terms. A new Source Type includes current terms links, mapping fixtures, and a
governed probe.

## Settings and user experience

Administrators configure, verify, publish, deactivate, and rotate sources in Resource
Sources. The page presents business state, supported resources, a license summary,
and recovery actions. It does not expose adapter class names, SecretVersion, raw JSON,
or internal error payloads.

Ordinary users see available sources and unified search results. Actions are “Add to
canvas” and “Save to library”; the UI does not explain Artifact, Storage, or provider
orchestration.

## Code locations

- `packages/database/src/runtime/resource-source-store.ts`: source control-plane
  persistence.
- `apps/server/src/resource-sources/`: trusted adapters and catalog normalization.
- `apps/server/src/http/workspace-resource-sources.controller.ts`: administration,
  catalog, and adoption HTTP entry points.
- `apps/web/src/features/assets/`: resource catalog and picker.

A new adapter reuses the normalized candidate, transport, license, and adoption
boundaries. Page and Canvas code never call an external platform directly.
