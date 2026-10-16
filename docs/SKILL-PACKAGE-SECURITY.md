# Skill-package security and import

This document defines the minimum security profile when dynamic Skill and Workflow
content first enters Kanvas. It does not create a marketplace or general code sandbox.

## Trust boundary

- Only an instance administrator or Workspace Principal with `skill_package.import`
  may initiate import.
- Sources are local uploads or already-authorized StoredObjects. The current profile
  does not fetch a package from a manifest URL.
- A trusted importer does not make content trusted. Every package enters quarantine,
  resource validation, publication review, and an immutable Revision.
- Package text is untrusted data and gains no Agent instruction, tool permission,
  network egress, or template-execution authority.
- External registries, publisher PKI, cross-instance signing trust, automatic updates,
  and dependency solving are out of scope.

## Import pipeline

```text
UploadSession / StoredObject
-> quarantined ImportRecord
-> archive inventory
-> safe extraction and media probe
-> canonical manifest
-> mutable Draft
-> immutable PublicationCandidate
-> security, schema, and eval checks
-> human review
-> immutable Revision
```

ImportRecord stores Workspace, actor, source object, original hash, parser and profile
version, inventory, diagnostics, and final Draft or Candidate reference. Failed records
and source objects follow security retention policy and never enter runtime search.

## Archive profile

The current profile accepts a single-level ZIP only, not TAR, executable installers,
or nested archives.

Before writing any file, the parser inventories the central directory and rejects:

- absolute paths, `..`, empty segments, control characters, and platform-reserved
  names;
- symbolic links, hard links, devices, FIFOs, and other nonregular files;
- names that collide after Unicode or case normalization;
- encrypted entries, unsafe data descriptors, and declared or actual size mismatch;
- configured limits on files, single-file size, extracted size, compression ratio,
  path depth, or filename length;
- ZIP files and other archives inside the archive.

Extraction uses a random isolated temporary directory per import. A package path never
becomes an object-storage key directly. Validated resources are ingested again through
the Storage port as immutable StoredObjects. One import reuses its current
storage-profile compatibility probe and persists validated resources with at most four
concurrent writes. Every active write in a batch settles before a failure is returned,
and Draft creation starts only after all resources are committed.

## Content profile

Allowed logical content includes:

- UTF-8 Markdown, JSON, YAML, plain text, and retained script source;
- restricted images, templates, fonts, and eval fixtures;
- published Workflow JSON.

JavaScript, TypeScript, shell and Python source is retained as plain text for human
viewing and export, never executed or exposed through Agent reference/script reads.
The current profile rejects executable binaries, HTML, Office macros, and unknown formats. SVG is rejected as untrusted active content
until a dedicated sanitizer or rasterizer, security review, and resource budgets exist.
Media validation uses magic bytes and a safe decoder or probe rather than extensions
or declared MIME.

YAML and JSON parsing disables custom tags, object construction, alias bombs, and
prototype keys. Markdown is content: rendering disables raw HTML and allowlists link
protocols. Font, image, and template parsing runs with CPU, memory, pixel, page, and
timeout limits in a restricted Worker or process.

## Canonical manifest and hash

`kanvas.yaml` validates against a versioned JSON Schema and fails closed on unknown
security fields. Its canonical form includes:

- profile and schema version;
- package identity and compatible Kanvas range;
- a resource inventory sorted by normalized relative path;
- bytes, SHA-256, media type, and purpose for every resource;
- Workflow entry points and pinned Revision or inline-content hash;
- required capabilities, data classes, network needs, and minimum approval mode.

Package hash covers the canonical manifest and resource-hash list, independent of ZIP
bytes, timestamps, or file order. Candidate and Revision pin package hash, parser and
profile version, and every StoredObject ID.

## Prompt injection and runtime use

- UI, retrieval, and Agent Context label Reference and Instruction text with source,
  package, Revision, and trust level.
- Imported text cannot override system or Workspace policy, authorization, budget,
  approval, data egress, or ToolView.
- Agent receives only the minimum fragments selected for the current task and policy;
  installing a Skill does not inject all package content into every thread.
- Instructions to call tools, upload data, or ignore rules remain data. A tool call
  still passes contract validation, authorization, approval, budget, and egress policy.
- External links are not fetched automatically. Fetching requires a separate auditable
  Capability.
- Evals include prompt-injection, data-exfiltration, and unauthorized-tool suggestions.

## Publication, revocation, and execution

- Publication requires schema, security, and eval checks plus ReviewDecision for the
  same Candidate hash.
- A published Revision and its resources never change in place; a change creates a new
  Candidate and Revision.
- `revoked` immediately prevents new installation, enablement, and Run creation;
  unstarted Attempts do not dispatch.
- An existing Run pins its Revision, but dispatch rechecks revocation, Capability,
  Credential, egress, and budget. Security revocation may fail it closed.
- Import, review, publication, enablement, revocation, and sensitive-content access are
  Tier A Audit events.

## Verification

At minimum, verify that:

- Zip Slip, links, Unicode or case collisions, archive bombs, nested archives, and
  forged MIME are rejected;
- the same logical content produces the same package hash across ZIP order and
  timestamp changes;
- unknown manifest security fields, executable binaries, HTML, SVG, and remote URLs fail closed;
- Draft changes during review do not change a Candidate hash;
- a revoked Revision cannot create a Run or new dispatch;
- prompt-injection fixtures cannot expand ToolView, egress, budget, or skip approval;
- no failure path leaks paths, secrets, full content, or temporary files into logs,
  traces, or Audit.

Measure limits against real scenario packs and keep them as bounded deployment
configuration. A package cannot raise them.
