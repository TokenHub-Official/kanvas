# Observability and operations

## Signals and business facts

Logs, traces, and metrics support diagnosis; they do not replace business state.

| Signal               | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| Pino JSON log        | Process-local events and error diagnosis             |
| OpenTelemetry trace  | Timing for one short-lived operation                 |
| Metric               | Bounded-dimension capacity, latency, and error rates |
| Operational timeline | Long-lived execution history projected from MySQL    |
| AuditEvent           | Evidence for security and control-plane changes      |

WorkflowRun, NodeRun, CapabilityRun, Attempt, AgentRun, provider request, and Outbox
IDs correlate work across hours or days. A trace ID is not a business primary key.

## Structured logs

A log includes at least:

- timestamp, level, service, release version, instance ID, and process role;
- request ID or a stable business ID;
- a bounded event or code;
- low-cardinality numbers such as duration, attempt, and generation.

Logs must not contain:

- secrets, tokens, cookies, or authorization headers;
- prompts, user documents, Artifact content, or uploaded bytes;
- SQL parameters or raw provider requests and responses;
- complete URL queries, storage credentials, or internal object keys.

At a boundary, an error is projected to a stable code and bounded message. A stack is
available only in controlled local diagnostics.

Agent execution emits correlated structured events without prompts or Tool payloads:

- `agent.run.claimed`, `agent.run.first_output_persisted`,
  `agent.run.completed`, and `agent.run.failed` cover queue wait, first visible
  persistence, terminal status, limits, and bounded failure metadata;
- `agent.model.request_started`, `agent.model.first_output`,
  `agent.model.succeeded`, and `agent.model.failed` cover preparation, Provider
  first-output and total latency, finish reason, Provider request identity, model
  identity, and available input/cache/output/reasoning token counts;
- `agent.auxiliary.failed` identifies optional title or memory work that failed
  without changing the primary Run result.

Every event includes the normal Pino timestamp plus an explicit `observedAt` and the
relevant Workspace, Thread, Run, Model Call, purpose, and duration fields. Failure
events record only bounded error types, stable codes, HTTP status, and side-effect
classification; raw prompts and Provider bodies remain excluded.

## Traces and metrics

Server, Worker, and critical adapters use OpenTelemetry. Resources identify at least
`service.name`, `service.version`, `deployment.environment`, `service.instance.id`,
and `kanvas.process.role`.

Spans cover HTTP, Application, database transactions, queue relay, claims, provider
calls, and Storage operations. Prompts, secrets, and user content never enter
attributes.

Metric labels use only low-cardinality dimensions such as role, outcome, execution
target, adapter kind, and error family. Workspace, Run, Artifact, and provider request
IDs are not normal metric labels.

Minimum operational metrics cover:

- HTTP and queue latency and failure rate;
- Outbox lag, Inbox duplicates, and poison delivery;
- claims, lease loss, deadlines, retry, and fallback;
- provider observation and unknown effects;
- budget reservation and settlement;
- Storage upload, verification, and garbage collection;
- Agent model calls, tool calls, and terminal Thread Run states.

## Audit

Control-plane and security operations write AuditEvent records for:

- identity, Membership, Invitation, and service tokens;
- provider settings, secrets, models, pricing, and bindings;
- Capability, Workflow, and Skill publication or revocation;
- Brand, data egress, budget, and instance policy;
- backup, restore, and recovery operations.

High-frequency business execution uses domain facts and immutable Outbox records; it
does not duplicate every heartbeat into Audit. Audit stores only the necessary
identity digest and change result, never secrets or user content.

## Processes and roles

Long-running processes are:

- Server;
- Web with Nginx;
- Worker roles: orchestration, execution, provider execution, outbox relay,
  scheduler, reconciler, and maintenance;
- MySQL;
- Redis.

Worker roles may run in one process or split by load. All share
InstanceRuntimeState and the execution generation fence.

## Health

- **Live**: the process event loop and HTTP server still function.
- **Ready**: required configuration, database, queue, Storage Profile, runtime
  release, and role dependencies have passed validation.

A temporarily failing provider account usually leaves Server live but makes the
corresponding Binding or Capability unavailable. A failed database, generation fence,
or critical dependency for an enabled role prevents ready state.

Shutdown order:

1. Leave ready state and stop new claims.
2. Stop Scheduler and Relay polling.
3. Complete or release leases during the grace period.
4. Flush bounded telemetry.
5. Close HTTP, queue, and database connections.

## Releases and migrations

- The complete image defaults to migration before starting business processes.
  Restricted deployments run a release migration Job and use check-only startup;
  standalone Server/Worker roles default to check-only.
- The first public version contains only `0000_initial_schema.sql`.
- Migrator uses a database lock, checksums, a release version, and explicit failure
  state.
- MySQL DDL can partially commit; an unknown failed step is not automatically replayed.
- Application images roll out only after successful migration.
- Release version, image digest, and schema state become operations evidence.

See [deploy/README.md](../deploy/README.md) for the Docker and Compose baseline.

## Backup

A recoverable BackupSet records:

- MySQL snapshot and binlog position;
- object-storage coverage and inventory;
- migration inventory and checksums;
- secret and KEK identity or deployment references;
- release and image versions;
- creation time, verification digest, and retention policy.

A database backup alone or a bucket copy alone is not a recoverable system backup.
Local Storage deployments include the bind-mount root directory.

## Restore

RestoreOperation is an explicit state machine:

```text
requested
  -> validating
  -> restoring_database
  -> restoring_objects
  -> verifying
  -> reconciling
  -> completed | failed
```

The instance remains not ready or read-only during restore. Verification covers at
least:

- migration and schema checksums;
- database and object inventories;
- StoredObject and Artifact reference integrity;
- secret and KEK resolvability;
- Outbox, queue, and generation fence;
- permissions, provider settings, and budget facts;
- representative Artifact reads.

After restore, increment the execution generation before rebuilding replayable queue
and Reconciler state. This prevents an old Worker from committing.

## Common incident diagnosis

### Workflow makes no progress

1. Read WorkflowRun, NodeRun, CapabilityRun, and Attempt.
2. Check Outbox lag, Inbox receipt, lease, deadline, and generation.
3. Check the current candidate's execution-target health.
4. Redeliver or reconcile only when business facts permit it.

### Provider timeout

1. Read provider request or task identity and observations.
2. Determine whether the side effect is unknown.
3. Check budget reservation and settlement.
4. Do not blindly retry or release all cost.

### Artifact download failure

1. Revalidate authority, Artifact availability, and StoredObject.
2. Check the Storage Profile probe and range reads.
3. Distinguish a missing original, missing preview, and expired Blob URL.

### Redis loss

1. Preserve MySQL business facts.
2. Increment or validate the generation.
3. Rebuild deliveries from Outbox and database state.
4. Do not infer business completion from old queue state.

## Verification

- Log-redaction and metric-cardinality tests.
- Health, shutdown, and every Worker role.
- Disposable-MySQL migration, Outbox, fence, and recovery tests.
- Backup manifest, object inventory, and restore drills.
- Provider unknown effects, duplicate settlement, and Storage orphan cleanup.
