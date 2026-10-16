# Data access, transactions, and migrations

This document turns [ADR-0014](decisions/0014-drizzle-mysql-data-access-and-migrations.md)
into engineering constraints. It does not enumerate every business table; it defines
the access model and verification standard for the platform.

## Technology choices

| Area              | Decision                                                             |
| ----------------- | -------------------------------------------------------------------- |
| Database          | MySQL 8.0 with InnoDB                                                |
| Driver            | `mysql2`                                                             |
| ORM/query builder | Exact-pinned current stable Drizzle ORM                              |
| Migrations        | Drizzle Kit may generate a draft; committed and executed form is SQL |
| Fallback          | Kysely with `mysql2`                                                 |
| Transaction owner | Application service                                                  |
| Domain boundary   | Domain does not depend on Drizzle, row types, or SQL                 |
| Native SQL        | Allowed in named query/repository methods with real MySQL tests      |

Prisma has a mature ecosystem and strong types, but its shadow-database permissions
and generated client do not provide a decisive benefit for the required explicit SQL
and transaction model. MikroORM better serves entity graphs and a unit of work.
Kysely also fits the architecture, while Drizzle additionally expresses schemas and
generates migration drafts, making it the primary choice.

## Three database facts

```text
Drizzle Schema -- describes current application expectation --+
                                                              +-> CI drift check -> runnable version
SQL Migration -- records immutable evolution -----------------+
                                                              |
Actual MySQL Schema -- runtime fact ---------------------------+
```

Each has a separate responsibility:

- Change the Drizzle schema first, then generate or write a SQL migration.
- Before merge, review migration locks, data loss, defaults, indexes, backfills, and
  compatibility windows.
- Never edit a migration after it reaches a shared environment; repair errors with a
  new migration.
- CI replays every migration from an empty database and compares the resulting schema.
- Production runs a standalone migrator before rolling Server and Worker. Application
  processes do not create or alter tables automatically.
- Repository-reviewed triggers protect append-only and immutable facts. Instances
  with binary logging must set `log_bin_trust_function_creators=ON` in advance. The
  migrator checks this before business DDL and fails closed; do not grant `SUPER` to
  application or migration accounts as a workaround.

## Packages and dependency direction

```text
Domain
  ^
Application -- Repository Port / Query Port / TransactionContext
  ^
MySQL infrastructure -- Drizzle Schema / Repository / Query / Migrator
  ^
Server / Worker composition root
```

The following are prohibited:

- Controllers, queue consumers, or Capability adapters constructing business SQL.
- Domain importing Drizzle, `mysql2`, or database row types.
- Frontend code treating database schemas as API contracts.
- A generic base repository exposing arbitrary-table `save`, `delete`, or `update`.
- A repository secretly opening an independent transaction and breaking the caller's
  atomic boundary.

## Repositories, queries, and transactions

### Semantic interfaces

Interfaces are named for business commands, for example:

- `attemptRepository.tryAccept(...)`
- `quotaRepository.reserveForUpdate(...)`
- `publicationRepository.publishCandidate(...)`
- `outboxRepository.append(...)`
- `artifactLineageQuery.findAncestors(...)`

A repository can perform a simple single-aggregate update. Application services
coordinate cross-aggregate invariants.

### TransactionContext

An Application service opens a transaction through the shared transaction manager and
passes an opaque `TransactionContext` to all participants. Infrastructure resolves it
to the same Drizzle/mysql2 session. Interfaces do not expose driver types.

```ts
transactionManager.run(async (tx) => {
  const accepted = await attempts.tryAccept(command, tx);
  if (!accepted) return alreadyResolved();

  const artifact = await artifacts.createFromAttempt(command, tx);
  await attemptOutputs.attach(artifact, tx);
  await outbox.append(attemptCompleted(artifact), tx);
});
```

This example expresses ownership, not a required API shape.

### Concurrency patterns

| Scenario                | Preferred mechanism                             | Notes                                    |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- |
| Adopt one Attempt       | Conditional `UPDATE` by expected state/version  | Zero affected rows means already handled |
| Autosave a Draft        | `UPDATE ... WHERE version = ?`                  | Return current version on conflict       |
| Reserve quota or budget | `SELECT ... FOR UPDATE` in a short transaction  | Fixed lock order; no network calls       |
| Claim an Outbox batch   | `FOR UPDATE SKIP LOCKED` plus a lease           | Delivery remains at least once           |
| Report or long scan     | Read-only/autocommit; use a replica when needed | Avoid long-held versions or locks        |

Never invoke a provider, object store, browser, or Redis inside a database
transaction. Link external side effects through state, idempotency keys, and Outbox
records.

### Retries

- Retry only explicit MySQL deadlock or temporary lock-wait errors.
- Retry the entire transaction callback, not one failed statement.
- Require a command-level idempotency key and a finite attempt count; use exponential
  backoff with jitter.
- Do not automatically retry validation errors, business uniqueness conflicts, or
  unknown database errors.
- Record the Attempt or Command, count, MySQL error code, and trace ID for each retry,
  but never a secret.

## Native SQL boundary

Parameterized native SQL is appropriate for:

- batch claims using `SKIP LOCKED`;
- recursive-CTE Artifact lineage queries;
- generated columns, functional indexes, or DDL Drizzle cannot express accurately;
- bulk upserts, aggregates, and reports needing execution-plan control;
- conditional state transitions implemented in one statement.

Native SQL must:

1. Live in a semantically named repository or query object.
2. Bind parameters and never concatenate user values or identifiers.
3. Declare its return type and validate nullable, decimal, and date values at the
   boundary.
4. Have a real MySQL integration test and an `EXPLAIN` baseline for critical queries.
5. Be revalidated when the MySQL patch version changes.

## Type conventions

| Domain value      | MySQL                                            | Constraint                                        |
| ----------------- | ------------------------------------------------ | ------------------------------------------------- |
| ID                | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | App-generated ULID; identical PK/FK types         |
| Time              | `DATETIME(3)`                                    | UTC connection; ISO 8601 API output               |
| Hash              | Fixed-size `BINARY` or ASCII `CHAR`              | No wide-character collation                       |
| Internal quota    | `BIGINT`                                         | Integer smallest unit; application overflow check |
| Money or cost     | `DECIMAL(20,8)` plus `CHAR(3)` currency          | String/Decimal in driver; never JS Number         |
| State/open enum   | `VARCHAR`                                        | Validated by Application and Contract; no ENUM    |
| Boolean           | `BOOLEAN` or `TINYINT(1)`                        | One consistent mapping                            |
| Variable metadata | `JSON`                                           | Does not carry FKs, uniqueness, or main filters   |
| Binary content    | Object storage                                   | MySQL stores StoredObject metadata and references |

Every tenant business table carries `workspace_id` explicitly or proves Workspace
ownership through a short, fixed chain. High-frequency indexes usually begin with
`workspace_id`, but query shape and `EXPLAIN` determine final order.

## Migration lifecycle

### Development

1. Change the Drizzle schema.
2. Generate a migration draft and add custom SQL where needed.
3. Review SQL and snapshots manually.
4. Replay from an empty database.
5. Upgrade from the previous release and run integration tests.
6. Run the drift check before merge.

### Release

1. Create a backup and verify its recovery point.
2. Run Migrator explicitly as a standalone release step. Do not depend on application
   startup or Compose `service_completed_successfully` for implicit migration.
3. Record migration names, checksums, start and finish times, and the failed statement
   when applicable.
4. Deploy application code compatible with both old and new schemas.
5. Backfill and verify in the background.
6. Remove old columns, indexes, and compatibility code in a later release.

Do not hide irreversible cleanup or a large-table rewrite in an ordinary application
release. Validate locking and duration for large DDL against the target environment.

### Self-hosting

- Docker Compose provides a standalone one-shot `migrate` task.
- Documentation states directly supported upgrade ranges and backup prerequisites.
- Server and Worker may check the schema version before startup but do not modify it.
- Down migrations are not promised; recover by rolling back compatible application
  code or applying a forward fix.

A named lock prevents concurrent migrators but does not prove version compatibility.
Every release manifest declares the application schema minimum and maximum, direct
upgrade sources, and migration checksums. Schema evolution follows Expand -> Backfill
-> Contract. Server and Worker reject an incompatible range or checksum drift. See
[OBSERVABILITY-AND-OPERATIONS.md](OBSERVABILITY-AND-OPERATIONS.md) for deployment,
backup, and recovery order.

## Disposable MySQL integration verification

`pnpm test:integration:mysql` creates a random derived database, applies the complete
migration set, runs every database integration test, and removes the database and
temporary account. The harness accepts only explicit disposable-integration
configuration and must never target shared development, test, staging, or production
instances.

The suite covers:

- empty-database migration, checksums, and schema inventory;
- ULID, Decimal, JSON, generated-column, time, and character-set round trips;
- optimistic concurrency, compare-and-swap, leases, fences, and duplicate commands;
- atomic Attempt completion and Artifact, Usage, and Outbox consistency;
- Outbox and Inbox behavior, reconciliation, cancellation races, and poison isolation;
- Identity, Authorization, Provider, Storage, Brand, and Agent persistence facts.

CI uses MySQL 8.0 and creates least-privilege migration and harness accounts. Before
target deployment, confirm the exact patch version, `sql_mode`,
`lower_case_table_names`, collation, time zone, account permissions, connection
limits, and online-DDL behavior. Container tests do not prove backup, point-in-time
recovery, or lock performance in the target infrastructure.
