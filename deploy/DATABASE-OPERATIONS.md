# Database release operations

The Server image contains the application, reviewed migration SQL, and the
`kanvas-db` command. Run database operations inside the target environment with
its network access and credentials. Production operations belong in that target
environment. Local-image validation against a shared test database requires explicit
owner authorization and must not reset existing data or alter global parameters.
Only MySQL is currently supported.

## Commands

| Command             | Behavior                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kanvas-db migrate` | Initialize tables in an empty database or apply pending migrations to an existing installation; already applied migrations are validated and skipped |
| `kanvas-db status`  | Connect read-only, validate history, and report applied and pending migrations; does not create tables                                               |
| `kanvas-db check`   | Read-only check; exits unsuccessfully for uninitialized, pending or invalid migration history                                                        |
| `kanvas-db plan`    | List the image's migration inventory and checksums without connecting to a database                                                                  |
| `kanvas-db --help`  | Print usage without loading configuration or connecting                                                                                              |

The database itself and its users must be provisioned by operations. `migrate`
does not create a database, copy development data, enable registration, or create
a default administrator/password. First administrator setup remains a separate,
privileged operation described in [Docker deployment](README.md).

## Provider policy initialization

Redeeming the first administrator setup token creates the instance and first
workspace Provider policies in the same transaction as the administrator and
workspace. The default instance policy caps each request at USD 2 and 300 seconds;
deployment constraints, route constraints and team budgets still apply. The
workspace starts with no admitted endpoints; activating a validated connection
adds its endpoint through the existing policy publication flow. No demo endpoints,
credentials or fixed workspace IDs are installed.

For older initialized installations, run `kanvas-db migrate` from the updated
release image (automatic startup already does this). After schema validation it
fills missing Provider policy bindings for active workspaces using an existing
active administrator. Existing bindings and policy documents are never replaced.
An orphaned latest published revision is reused; an unpublished latest revision
requires administrator review rather than silently installing a permissive default.
Before an administrator exists, this step does nothing; first-owner setup owns it.
Check-only runtime does not perform this backfill. Repeated migration is idempotent.
Do not use the demo Provider bootstrap script to repair a deployed installation.

## Kubernetes release gate

Use [the migration Job](k8s/migrate-job.yaml), replacing its release-specific name,
image and release version, and apply it in the application's namespace. Use the
exact Server image for the release. A separate `kanvas-migration` Secret provides
`KANVAS_DATABASE_URL` for the migration account. It need not contain S3, Redis,
OIDC or application signing credentials. Grant required database-scoped DDL privileges to
that account, not permanently to the runtime application account.

The deployment controller must wait for Job success before updating applications.
Creating the Job and Deployments in the same apply operation does not establish
this dependency. Kubernetes Jobs are not an exactly-once guarantee: the migration
runner's database lock and durable history are still required.

Use `backoffLimit: 0` and bounded execution time. On failure or timeout, halt the
release and inspect the Job and migration status. Do not automatically remove
failed history, replay partially committed DDL, roll back schema by switching an
image, or disable the database's binary log. MySQL DDL is not generally a single
rollbackable transaction. An uncertain migration needs operator assessment.

The default complete-image entrypoint automatically migrates before starting the
application. Restricted deployments explicitly set `KANVAS_DB_MIGRATION_MODE=check`
and use the release Job above; restarting/scaling those workloads needs no DDL
privileges. Separate Server/Worker commands default to check mode. The CLI also
permits a controlled one-off execution when a release controller is unavailable.

## Compatibility and prerequisites

- Release schema changes must remain compatible with old application replicas
  during rolling deployment. Use additive changes first, switch application use,
  and remove old columns in a later release. If a change is incompatible, use an
  explicit maintenance/drain window.
- Back up database facts and corresponding object data before destructive changes.
- Keep one stable instance identity and provide the release version as evidence.
- The portable baseline creates no triggers and requires no global MySQL settings.
  Application transactions preserve business invariants; privileged direct SQL
  mutation is not a supported business-operation interface. Historical triggers
  remain in already-installed databases; they are not silently dropped.
- The original pre-release baseline is archived in `migrations/legacy`. Only its
  known checksum and the matching portable baseline checksum are explicitly
  compatible. Applied history is retained; unknown checksum drift still fails.
- Do not generate migrations by comparing application models inside production.
  Execute the versioned SQL delivered by the image.
- Retain release Job results long enough for diagnosis, and avoid logging URLs,
  passwords or administrator setup links.

GitLab's build stage does not need database access. It builds and pushes images;
the release controller or an authorized deployment job creates the Kubernetes
Job, waits for success, and then rolls out the applications.

## System catalog initialization and upgrades

The first-owner transaction now installs the default Runtime Adapter revisions as
well as registering the default capability/model-resource recommendations. It does
not install demo workflows, model resources, Provider credentials or model choices.
`kanvas db migrate` loads the catalog bundled in the release and repairs active
Workspaces, one transaction per Workspace, after the schema and Provider policies.
A fresh definition selects the latest packaged revision. Existing revision pointers
and disabled/revoked states remain unchanged. Repeated runs are idempotent; a
same-identity/different-digest conflict stops the release for operator review.
Use a new immutable catalog asset/revision for changed definitions. Check mode is
read-only and does not perform the repair.

After the owner configures Providers, model profiles, prices, budgets and Agent
model selections, run `kanvas preflight --workspace-id WORKSPACE_ULID` inside the
complete image. It validates Server/Worker configuration and database version,
then reads system catalog, policies and Agent model readiness without mutation or
model calls. Exit 2 means configuration is incomplete; nonzero failures block the
business acceptance gate. The output contains reasons, never credentials. Optional
disabled adapters are reported separately and are not silently re-enabled.
Preflight cannot establish remote execution or result download: verify the selected
capability with a representative task after it succeeds.

### Provider capability readiness

`KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON` is an optional operator restriction.
When configured, supply it consistently to Server and Worker; its limits intersect
with persisted instance, Workspace and route policies. When absent, the exact
persisted route is still checked against all three policies, credentials, model,
pricing and budget requirements. Invalid supplied bounds fail validation.
The complete optional shape is shown in `.env.example`.

Preflight now inspects enabled Provider capabilities as well as Agent text models.
An unavailable effective invocation schema fails the
business-readiness gate. Management retains the configured implementation and
reports Agent availability separately. Capability discovery preserves bounded
exclusion reasons in Run diagnostics; it does not translate an unavailable or
incomplete catalog into an empty Workspace.

Migration `0003_agent_thread_view_revision.sql` adds a view revision independent of
Thread edit versions and bounded discovery diagnostics on existing action receipts.
Deploy migrations before Server and Worker. During a rolling update, old writers do
not advance the view revision; drain in-flight Runs or complete the Worker rollout
before claiming snapshot ordering and lease-fenced writes. Retain old question
checkpoints for compatible resume. These additive fields need not be removed when
rolling back application code.

Provider KEK encryption is conditional, not a universal preflight prerequisite.
Plaintext-database secrets follow ADR-0027 without KEK. Existing encrypted secret
versions still require their original pinned keys; removing the environment map
never decrypts, migrates or downgrades those records. Preflight is not credential
decryption or live Provider acceptance proof.
