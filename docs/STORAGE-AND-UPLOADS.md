# Storage, uploads, and Artifacts

## Fact boundaries

- **StoredObject**: Workspace-isolated physical object identity, size, media type, and
  SHA-256 digest.
- **UploadSession**: state for one governed write, verification, and commit.
- **Artifact**: immutable business content with provenance, classification, and
  availability.
- **Asset**: a user-managed logical asset and its explicitly adopted current Artifact.
- **ArtifactReference**: an explicit reference from Canvas, Brand, Workflow, or
  another object to an Artifact.

An identical SHA-256 digest does not merge Workspace or business identities. Object
keys are random and never reused.

## Storage port

Current adapters are:

- **Local filesystem**: single-node self-hosting and development; requires explicit
  confirmation of a trusted root directory.
- **S3-compatible**: Server-owned streaming with conditional creation, HEAD and GET,
  range reads, and exact deletion.

Business code never constructs a bucket, container, or object key. A Storage adapter
accepts only governed object identities and bounded byte streams.

At startup, every enabled profile runs a compatibility probe that verifies:

- conditional creation and rejection of a same-key replay;
- seal, inspect, full read, and range read;
- SHA-256, media metadata, and exact deletion;
- declared write protection;
- the process's actual permissions for the root directory or bucket.

A failed probe prevents the relevant Server or Worker role from becoming ready.

## Upload lifecycle

```text
allocated
  -> writing
  -> sealed
  -> verified
  -> committed
```

A failed or expired session enters `cleanup_pending`. Maintenance deletes the exact
object under a lease and writes a final state.

UploadSession pins:

- Workspace, purpose, and producer Attempt;
- Storage Profile and random object identity;
- maximum byte count, expected media, and output role;
- write-protection mode;
- deadline, cleanup eligibility, and lease;
- verified size, SHA-256, and media facts.

Clients and providers cannot declare their own output `verified`.

## Write modes

Current public profiles use Server- or Worker-owned streaming:

- Server receives a bounded user-import stream;
- the execution process writes Worker output;
- a governed downloader writes provider results;
- a Browser Attempt uploads through server-issued authority.

Presigned, multipart, or direct-client writes require complete Storage port, CORS,
conditional-write, and recovery protocols. Exposing a URL alone is insufficient.

## Seal and verification

An object cannot be modified after seal. The verifier does not trust extensions or a
declared MIME type and checks at least:

- magic bytes and allowed media types;
- file size, dimensions, pixel count, and decoded memory;
- animation frame count and compression expansion;
- SHA-256 against adapter inspection facts;
- dedicated security policy for SVG, fonts, and other active content.

A failed object does not create a committed Artifact.

## Atomic commit

An Attempt output is written and verified outside the transaction, then committed by
one conditional MySQL transaction:

1. Revalidate Attempt lease, generation, deadline, and unadopted state.
2. Create StoredObject.
3. Create Artifact and AttemptOutput.
4. Write Usage, Settlement, and Outbox.
5. Move CapabilityAttempt and CapabilityRun into their unique terminal states.

If the transaction fails or its lease was lost, the written object remains an orphan
for garbage collection. It cannot be retroactively attached to committed business
facts.

A user import has its own commit transaction for StoredObject, Artifact, Audit, and
Outbox. Saving the Artifact as an Asset is a separate explicit user action.

In an Agent Thread, a composer upload remains an unadopted Artifact referenced by
the owner's message. Direct Agent Capability results and Agent-started Workflow
outputs also remain unadopted. While unadopted, these conversation Artifacts can
only be downloaded or previewed by their creating Principal; `asset.write` alone
cannot promote another Principal's private conversation content. The owner may
explicitly save an available image as a Workspace Asset, after which normal
Workspace Asset read/download authority applies. This does not retroactively
reclassify Assets created by older Agent uploads. Agent-started Run details
remain scoped to the requesting Principal while the conversation result is
private; ordinary Workspace Workflow Runs keep their existing policy. An
available Agent result may be staged as an exact Artifact input for a later
message in the same Thread without first saving it to the Asset library or
sending a message automatically.

## References and garbage collection

- Canvas Draft and Revision, Brand Revision, and other durable objects use explicit
  ArtifactReference records.
- Deletion requires proof that no active reference, delivery freeze, or legal hold
  remains.
- A committed object first receives a deletion intent; an out-of-transaction operation
  deletes its exact identity, then records `deleted` or `missing`.
- StoredObject tombstones remain and object keys are never reused.
- `cleanup_pending` work uses a claim lease, retry backoff, and generation fence.
- Garbage collection does not infer business ownership from bucket listings.

## Downloads

Every download revalidates Workspace authority, Artifact availability, and data
classification. Server may proxy a range stream, but it does not expose internal
storage credentials, buckets, or long-lived public URLs.

A preview is a separate representation. An original Artifact, preview Artifact, and
browser Blob URL never substitute for one another's identity.

## Configuration

See [CONFIGURATION.md](CONFIGURATION.md) for Storage environment variables, defaults,
and Local or S3 conditional fields. Production containers access an explicit local
storage bind mount as a non-root user.

## Verification

- Deterministic unit tests for Local and S3 adapters.
- Upload, commit, and garbage-collection transaction tests against disposable MySQL.
- Media, SVG, font, and decompression-budget tests.
- Attempt lease loss, duplicate completion, and orphan cleanup tests.
- A separate integration test against a real compatible endpoint when S3 is enabled.
