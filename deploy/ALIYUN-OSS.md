# Aliyun OSS provider

Select `KANVAS_STORAGE_KIND=oss` and provide the OSS variables listed
in [Configuration](../docs/CONFIGURATION.md). This provider uses the native
Aliyun SDK, not the S3-compatible endpoint. Credentials are injected environment
variables; they are not copied into images.

## Managed namespace and deletion protocol

An existing unversioned Bucket can be shared with other applications using
different prefixes. Kanvas requires exclusive write ownership of its configured
prefix. All Kanvas processes must use this provider; direct writes, overwrites,
restores or lifecycle expiry inside that prefix must be coordinated with the
application. Do not enable or suspend Bucket versioning for an active profile:
OSS's native forbid-overwrite request is ineffective in those modes.

Under the prefix, `objects/` contains payloads and `deletions/` contains permanent
key fences. Logical object keys are allocated once and never reused. The protocol
is:

1. Check that no deletion fence exists, then PUT with native
   `x-oss-forbid-overwrite: true`.
2. Check again after PUT. If a deletion was fenced concurrently, remove the
   payload and reject publication. A lost response is recovered through the
   persisted object facts and normal upload retry path.
3. Reads and signed URL issuance reject fenced keys. The verification core checks
   byte counts, SHA-256 metadata, ETag-bound reads and requested ranges.
4. Deletion first validates the committed object facts, then atomically creates
   a fence with native forbid-overwrite. Once fenced, this key cannot be published
   again. Physical deletion can then be retried without deleting a valid replacement.
5. Unpublished cleanup also fences absent objects. Maintenance workers repeatedly
   scan bounded pages of fences and remove late server-side completions left by
   failed or terminated uploaders. Failed passes retain the cursor/markers for retry.

OSS does not implement the S3 conditional-delete contract. This protocol therefore
relies on exclusive provider ownership of the prefix and persistent non-reuse
fences, rather than claiming that a raw OSS DELETE honors `If-Match`.

Never delete or expire fences while the profile can be used. They are small but
permanent metadata and must be included in backup/restore coverage. At least one
Worker must run the `maintenance` role for eventual cleanup of ambiguous late
uploads. Operations needs object read/write/delete and prefix-list permissions,
plus Bucket-versioning read permission for startup validation. Prefix rules must
cover both payload and fence namespaces.

## Validation

The same runtime storage compatibility probe checks duplicate writes, immutable
seal recovery, full checksum, Range reads and idempotent deletion. Isolated tests
also cover competing creates, delayed uploads, process-loss cleanup, failed delete
recovery and rejection of mismatched content facts. Runtime versioning validation
fails closed if the required unversioned state cannot be established.

Do not use arbitrary production objects for testing. Use isolated probe keys
under the managed prefix. Probe payloads are removed; their fences are intentionally
retained. A successful storage probe does not replace end-user authorization,
workflow or restore verification.
