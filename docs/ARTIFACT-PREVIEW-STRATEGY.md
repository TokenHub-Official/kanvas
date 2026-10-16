# Artifact Preview Strategy

Artifact previews are derived display representations. They are not Assets,
business Artifacts, or Artifact lineage nodes.

## Modes

`KANVAS_ARTIFACT_PREVIEW_MODE=on_demand` preserves the compatibility path:
the Server authorizes and reads the source Artifact, then generates a bounded
WebP response for that request.

`KANVAS_ARTIFACT_PREVIEW_MODE=async_persisted` enables event-driven
materialization for newly imported images and Canvas exports. Artifact commit
finishes before the Outbox event reaches the Worker, so preview generation is
never part of upload/export response latency.

`KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS=true` is the recommended rollout
setting. If a representation is absent, still pending, or belongs to an older
profile, the Server uses the on-demand path. Setting it to `false` makes a miss
fail closed with `503` and is intended only for deployments that require a
strict persisted-only serving policy.

Existing Artifacts are not eagerly backfilled by enabling the mode. They remain
available through fallback. A separately rate-limited backfill command can be
added after production demand is measured.

## Generation profile

Width, height, WebP quality, and WebP effort form an immutable profile version.
Changing any value creates a new representation identity; it never mutates
existing bytes. Browser requests carry a representation protocol revision and
use a one-day private revalidation window so deployment tuning converges
without discarding normal refresh caching.

## Worker isolation

Generation runs on the orchestration Worker after `artifact.user_imported` or
`artifact.canvas_exported`. The configured preview semaphore bounds Sharp
concurrency independently of BullMQ concurrency. Generation attempts and
exponential retry delay are deployment settings.

## Authorization and lifecycle

Every read authorizes and revalidates the source Artifact. A persisted
representation never grants independent access.

When a source Artifact expires, a database trigger marks its representations
for deletion. The maintenance Worker deletes the exact object using its stored
size, SHA-256, and immutable identity hash, then records `deleted` or `missing`.

## Required deployment alignment

Server and Worker must receive the same preview profile variables and Storage
profile. `async_persisted` requires Storage on Server and Worker. At least one
Worker deployment needs the `orchestration` role for generation; a Worker with
the `maintenance` role performs derived-object cleanup. These roles may run in
the same process or in separate processes.
