# Docker deployment

Kanvas ships one application image, one container and port 8080. MySQL and Redis
are external services; files use a persistent local volume, S3 or native Aliyun
OSS. GitLab, Matrix and Kubernetes are not required for self-hosting.

## First installation

1. Provision a MySQL 8.0 database and an account scoped to that database, and Redis.
2. Copy `deploy/.env.example` to `deploy/.env`. Set the database/Redis URLs, public
   HTTPS origin and a randomly generated authentication secret. Keep an existing
   custom instance identity when upgrading. URL-encode reserved characters in credentials. Keep this file private.
3. Use an immutable release image in `KANVAS_IMAGE`, or build from the checkout.

From the repository root, for a prebuilt image:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml pull
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

For a source build, use `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build`.
The image initializes the empty database or upgrades existing tables **before**
starting Server/Worker. Failure stops startup with a nonzero exit. Restarting does
not reset data, accounts or setup state. No development fixtures are copied.

Generate a short-lived first-administrator setup link in a controlled terminal:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec kanvas kanvas admin --email=owner@example.com
```

Open the link as the intended administrator. Keep its token out of CI logs and
issue trackers. OIDC and Provider/Agent configuration are separate application
setup steps; see [configuration](../docs/CONFIGURATION.md).
No default administrator password is shipped.

## Permissions and restricted deployments

Fresh installation needs database-scoped SELECT, INSERT, UPDATE, DELETE, CREATE,
ALTER, INDEX and REFERENCES for the current migration inventory. It does not need
CREATE DATABASE, CREATE USER, SUPER, TRIGGER or MySQL global-parameter changes.
Review additional DDL privileges when a future release changes its migration set.

The default `KANVAS_DB_MIGRATION_MODE=auto` uses the configured database account for
both initialization and running. For strict production permissions, use the same
image in a release task with a DDL account (`db migrate`), then run applications
with a DML account and `KANVAS_DB_MIGRATION_MODE=check`. Schema checks are read-only.
Never put administrator database credentials into the normal application workload.
See [database operations](DATABASE-OPERATIONS.md) and [Kubernetes](k8s/README.md).

## Connections and storage

- MySQL: `mysql://user:password@host/database?ssl=true` enables verified TLS.
- Redis: `rediss://user:password@host:port/0` supports TLS and ACL users. The supported
  baseline is standalone Redis; a logical database is not a permission boundary.
- Private certificate authorities may be mounted with the optional CA file settings.
  Ordinary credentials are environment variables; secret files are optional.
- The default named object volume starts with UID/GID 10001 ownership from the image.
  Keep the volume and storage profile ID across upgrades. Host bind mounts instead
  need matching ownership. Do not use `down -v` for normal upgrades.
- For S3 or OSS, replace the local storage variables with that provider's settings.
  [OSS configuration](ALIYUN-OSS.md) describes the native provider and prefix rules.
- The image trusts its one internal Nginx hop. Set the actual total trusted hop
  count when adding an external proxy and explicitly configure its addresses with
  `KANVAS_HTTP_TRUSTED_PROXY_CIDRS`. The default trusts only loopback. Every trusted
  hop must match an admitted IP/CIDR; proxies must overwrite forwarded headers.

## Upgrade and recovery

Back up MySQL, corresponding objects and persistent encryption/signing secrets.
Use a fixed release image, stop/drain the old single-container deployment, update
and start it. Automatic migration is serialized using a database lock. Failed or
interrupted DDL is not blindly replayed; inspect `kanvas-db status` and repair or
restore before retrying. Switching to an older image does not undo schema changes.

The startup, liveness and readiness routes are `/health/startup`, `/health/live`
and `/health/ready`. Allow up to 10 minutes for graceful Worker drain. A successful
container creation alone is not an application readiness check.

## Development and historical configurations

`compose.dev.yaml` supplies local development MySQL/Redis only. It is not production
configuration. The previous split-container example is retained as `compose.split.yaml`,
with `split.env.example` and `compose.split.smtp.yaml`, for existing installations.
New installations use the single-image `compose.yaml`; the old example is not needed.

## From installation to usable capabilities

Before enabling team use:

1. Fill the execution settings in `.env.example`: Worker roles (including `agent`,
   `provider-execution`, `reconciler`, `maintenance`), execution targets, supported
   HTTP Adapter keys, actual Provider request/result origins and persistent KEK.
   The example origins are placeholders, not a ready-to-use Provider connection.
2. Complete first-owner setup, then add and validate the real Provider connection.
   Import/select models, confirm token limits and tool calling against the Provider,
   publish pricing and set a bounded budget. Missing model metadata must be supplied
   explicitly; a reference-catalog refresh is optional and retryable.
3. Save the default/fast Agent models in Workspace settings. Install or create the
   capability needed for the first workflow and bind its actual published model.
   A catalog recommendation alone is not an installed business capability.
4. Run `docker compose --env-file deploy/.env -f deploy/compose.yaml exec kanvas
kanvas preflight --workspace-id WORKSPACE_ULID`. Resolve the listed configuration
   gaps; this command neither repairs data nor invokes a model.
5. Run a representative authorized task, verify its successful result and download,
   then verify history/files survive refresh and a controlled restart. Record the
   image digest, Workspace, Run and result evidence in the release handoff.

The complete image also ships `kanvas backup <create|verify>` and
`kanvas recovery <begin|verify|activate|abort>`. These are controlled operational
commands, never startup hooks. Backup creation requires existing coordinated
quiesced database/object snapshots; it does not schedule or produce those snapshots.
Mount snapshot input/output paths and provide the documented recovery configuration.
Use `node /app/recovery/dist/cli/main.js --help` for the command inventory, and
complete an isolated restore drill before accepting irreplaceable production data.

### Defaults and advanced overrides

The standalone image wires its bundled Worker roles and execution targets;
operators do not need to enumerate them in `.env`. An explicit
`KANVAS_WORKER_ROLES` or `KANVAS_ENABLED_EXECUTION_TARGETS` still takes precedence.
Installed Provider HTTP adapters are selected by default when Provider execution
is enabled; `KANVAS_PROVIDER_ADAPTER_KEYS` optionally restricts that set.
Workspace adapter installation and Provider/model configuration remain separate
requirements. API egress origins may be restricted further with
`KANVAS_PROVIDER_ALLOWED_ORIGINS`. Without that overlay, adapters use validated
saved Provider endpoints; HTTPS/address/redirect protections remain. Result downloads default to enabled with address and protocol protection; explicit
download switches and origin restrictions remain supported.

The image supplies its known local storage group only when no storage settings
are supplied. The default profile ID matches previous official templates and is
stable across restarts. Keep custom profile identities and volumes unchanged on
upgrade. External S3/OSS and custom local roots retain their complete explicit
configuration; the image does not inject local defaults into them.

The minimal deployment inputs are MySQL URL, Redis URL, public authentication
base URL and a persistent authentication secret. Provider KEK encryption is an
optional mode; without it, new Provider secrets use the existing database storage
mode described in ADR-0027. Never remove existing KEK versions while encrypted
records or pending tasks still reference them. Preflight checks configuration and
route readiness; it does not prove that every pinned credential can be decrypted
or that a live Provider accepts a request.
