# ADR-0037: Portable single-image installation with scoped database permissions

- Status: Accepted
- Date: 2026-09-17
- Supersedes the mandatory separate-migrator startup policy in ADR-0014/ADR-0021;
  their transaction, migration-history and failure-recovery requirements remain.

Kanvas must be installable from one application image with external database,
Redis and storage settings, including on managed databases whose operators cannot
change global MySQL parameters. The complete image automatically applies its
versioned migrations before starting business processes. Restricted deployments
run the same migration command as a release task and start the runtime with a
DML account in explicit check-only mode. Separate Server/Worker role commands
default to check-only mode. A failed migration or incompatible schema prevents
startup; initialization is not copying development data or generating SQL from
the current ORM model.

Fresh installation uses structural database constraints and application-owned
transactions, locks, conditional transitions and immutable publication APIs.
It does not create triggers or require SUPER/global settings. Privileged direct
SQL mutation is outside the business-command integrity boundary; removing triggers
does **not** preserve the previous direct-SQL tamper-rejection guarantee. Migration
and administration accounts must therefore remain controlled. Artifact expiry
cleanup is explicitly implemented in the application, and transitions that were
previously protected only by triggers require application regression coverage.

The original pre-release baseline is retained byte-for-byte under `migrations/legacy`.
Its known checksum is compatible only with the exact portable baseline whose table
definitions match it. Existing applied records are not rewritten; arbitrary checksum
drift still fails. Existing installations retain historical triggers; the application
does not silently drop them or raise its own privileges. Future SQL changes use new
forward migrations. This narrow baseline transition must not become a general way
to edit applied migrations.

The default automatic mode requires database-scoped DDL plus application DML. The
production check-only mode needs no DDL and verifies the configured instance was
initialized. Both modes use the same image and migration lock/history. Database and
Redis TLS verify certificates; Redis supports ACL usernames. Company CI transport,
registries and deployment tools remain external adapters, not product dependencies.

The rejected alternatives were requiring every installation to coordinate a K8s
Job, requiring global database configuration, and skipping triggers without replacing
their business effects. Validation must include restricted fresh installation,
historical upgrade, repeated startup, concurrent migration, failure gates, real TLS
and actual image runtime. A process starting or a CI deployment request succeeding
is insufficient evidence of a working installation.
