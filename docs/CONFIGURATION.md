# Configuration

Kanvas uses component-owned environment files for local development and normal
process environment variables in deployment. Runtime parsers remain the source
of truth; example files document only supported inputs.

## Ordinary standalone installation

For the official complete image, supply the MySQL connection, Redis connection,
public authentication base URL and persistent authentication secret. Choose an
image release. Roles, installed adapters, local-volume storage, production mode
and ordinary execution defaults are supplied by the image. Provider/model choice
and credentials are configured in the application, not duplicated in environment
policy documents.

Do not replace an existing deployment environment with the minimal example.
Existing nonempty explicit values (identities, storage, keys, roles, adapters, origin lists,
timeouts and switches) retain precedence. Omitted values receive the documented
current defaults. Blank optional scalar/list placeholders also use defaults; this
does not reinterpret explicit `false`, zero, or empty allowlists inside a policy JSON. Explicit `false` still disables result downloads. Encrypted
records still need their original KEKs; no key or data migration is implicit.

The tables below describe component-parser inputs. Official image defaults can
satisfy a required component input; split images and direct development processes
do not automatically inherit the complete image's storage or role defaults.

## Local files

Run `pnpm env:setup` once. It creates missing files without overwriting existing
ones:

| File                     | Owner                                                 |
| ------------------------ | ----------------------------------------------------- |
| `.env.local`             | Shared instance, MySQL, Storage and deployment policy |
| `apps/server/.env.local` | HTTP, authentication, Demo and Browser control plane  |
| `apps/worker/.env.local` | Redis, Worker roles, execution and Provider adapters  |
| `apps/web/.env.local`    | Public Vite build-time values only                    |

Deployment injects configuration through the orchestrator. Credentials may be
environment variables supplied by Kubernetes Secrets or mounted files. Do not copy
local env files into images. URL and split connection settings are mutually exclusive.

## Definition rules

- **Required** means the process cannot start without it. **Conditional** means
  it is required only when the named feature is enabled. Everything else is
  optional and should be omitted when the default is correct.
- Simple values remain scalar variables. Bounded lists use comma-separated
  values. Keyed maps and policy documents use JSON or a mounted JSON file.
- A single `KANVAS_CONFIG_JSON` would hide secret boundaries and make Compose,
  Kubernetes and platform overrides harder to audit, so it is intentionally not
  used.
- Direct passwords and credentials are supported in production through secret-backed
  environment variables. File alternatives and workload identity remain supported.

## Deployment orchestration variables

These values are consumed by Compose or release tooling, not by application
configuration parsers. Image tags keep local setup runnable; published releases
should replace them with immutable digest-pinned references.

| Variable                          | Necessity / default                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `KANVAS_SERVER_IMAGE`             | Optional Compose override; `kanvas-server:local`                                                        |
| `KANVAS_WORKER_IMAGE`             | Optional Compose override; `kanvas-worker:local`                                                        |
| `KANVAS_WEB_IMAGE`                | Optional Compose override; `kanvas-web:local`                                                           |
| `KANVAS_MYSQL_IMAGE`              | Required by Compose; exact MySQL 8.0 image reference                                                    |
| `KANVAS_REDIS_IMAGE`              | Required by Compose; exact Redis image reference                                                        |
| `KANVAS_SECRETS_DIR`              | Optional Compose secret directory; `./secrets`                                                          |
| `KANVAS_LOCAL_STORAGE_HOST_ROOT`  | Required by the Local Storage Compose profile; absolute host path                                       |
| `KANVAS_WORKER_STOP_GRACE_PERIOD` | Optional Compose duration; `10m`                                                                        |
| `KANVAS_IMAGE`                    | Single application Compose image; `kanvas:local` for source builds; pin a release digest for deployment |
| `KANVAS_BIND_ADDRESS`             | Published Compose port bind address; `127.0.0.1` by default                                             |
| `KANVAS_PORT`                     | Published Compose HTTP port; `8080`                                                                     |

## Shared Server and Worker variables

| Variable                                      | Necessity          | Default / structure                                                                                  |
| --------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `KANVAS_ENVIRONMENT`                          | Optional           | `development`; enum `development`, `test`, `production`                                              |
| `KANVAS_INSTANCE_ID`                          | Required           | No default; stable scalar deployment identity                                                        |
| `KANVAS_RELEASE_VERSION`                      | Optional           | `0.0.0-development`                                                                                  |
| `KANVAS_ENABLED_EXECUTION_TARGETS`            | Optional           | `worker`; comma-separated bounded set                                                                |
| `KANVAS_DATABASE_HOST`                        | Required           | No default                                                                                           |
| `KANVAS_DATABASE_PORT`                        | Optional           | `3306`                                                                                               |
| `KANVAS_DATABASE_NAME`                        | Required           | No default                                                                                           |
| `KANVAS_DATABASE_USER`                        | Required           | No default                                                                                           |
| `KANVAS_DATABASE_PASSWORD`                    | Secret alternative | No default; mutually exclusive with file form                                                        |
| `KANVAS_DATABASE_PASSWORD_FILE`               | File alternative   | Mounted secret path                                                                                  |
| `KANVAS_DATABASE_CONNECTION_LIMIT`            | Optional           | `10`                                                                                                 |
| `KANVAS_LOG_LEVEL`                            | Optional           | `info`                                                                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                 | Optional           | Absent disables remote OTLP export                                                                   |
| `KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON`   | Development only   | JSON map from stable Skill key to absolute `SKILL.md` path                                           |
| `KANVAS_PROVIDER_PROXY_URL`                   | Optional           | Exact HTTP(S) proxy origin, shared by Server and Worker                                              |
| `KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE`  | Optional           | Mounted JSON map from `deployment://` reference to secret file path                                  |
| `KANVAS_PROVIDER_KEK_MAP_FILE`                | Optional           | Mounted JSON map from KEK version to key file path                                                   |
| `KANVAS_PROVIDER_ACTIVE_KEK_VERSION`          | Conditional        | Required only to encrypt newly stored Provider keys; must exist in the KEK map                       |
| `KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON` | Optional           | Optional operator restriction; absent adds no overlay to persisted instance/Workspace/route policies |

## Server variables

For OAuth provider files, callback URLs, and account linking, see [OAuth sign-in](OAUTH-LOGIN.md).

| Variable                                    | Necessity              | Default / structure                                                                                                                  |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `KANVAS_HTTP_HOST`                          | Optional               | `127.0.0.1`                                                                                                                          |
| `KANVAS_HTTP_PORT`                          | Optional               | `3000`                                                                                                                               |
| `KANVAS_HTTP_TRUSTED_PROXY_HOPS`            | Optional               | `0`; set to the exact fixed proxy count                                                                                              |
| `KANVAS_HTTP_TRUSTED_PROXY_CIDRS`           | Optional               | Comma-separated trusted proxy IP/CIDRs; default `127.0.0.1/32,::1/128`. Every trusted hop must match; never trust arbitrary clients. |
| `KANVAS_CANCEL_GRACE_MS`                    | Optional               | `30000`                                                                                                                              |
| `KANVAS_AUTH_BASE_URL`                      | Required in production | Local default is the Server origin                                                                                                   |
| `KANVAS_AUTH_SECRET`                        | Secret alternative     | Required when no file is set; minimum 32 characters                                                                                  |
| `KANVAS_AUTH_SECRET_FILE`                   | File alternative       | Mounted secret path                                                                                                                  |
| `KANVAS_AUTH_TRUSTED_ORIGINS`               | Optional               | Base URL plus comma-separated exact origins                                                                                          |
| `KANVAS_AUTH_EMAIL_PASSWORD_ENABLED`        | Optional               | `true`                                                                                                                               |
| `KANVAS_AUTH_EMAIL_FROM_ADDRESS`            | Required with SMTP     | Visible verification-email sender address                                                                                            |
| `KANVAS_AUTH_EMAIL_FROM_NAME`               | Optional               | `Kanvas`; visible sender name                                                                                                        |
| `KANVAS_AUTH_EMAIL_SMTP_HOST`               | Optional               | Enables standard SMTP verification-email delivery                                                                                    |
| `KANVAS_AUTH_EMAIL_SMTP_PORT`               | Optional               | `587`                                                                                                                                |
| `KANVAS_AUTH_EMAIL_SMTP_SECURE`             | Optional               | `false`; use `true` for implicit TLS, commonly on port 465                                                                           |
| `KANVAS_AUTH_EMAIL_SMTP_REQUIRE_TLS`        | Optional               | `true`; require STARTTLS/secure transport                                                                                            |
| `KANVAS_AUTH_EMAIL_SMTP_USER`               | Optional               | SMTP login; omit with its password for an authenticated relay                                                                        |
| `KANVAS_AUTH_EMAIL_SMTP_PASSWORD`           | Secret alternative     | Direct SMTP secret; mutually exclusive with the file form                                                                            |
| `KANVAS_AUTH_EMAIL_SMTP_PASSWORD_FILE`      | Production credential  | Mounted SMTP password; required when an SMTP user is configured                                                                      |
| `KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE` | Development/test only  | Absolute JSONL file for local verification journeys; never production                                                                |
| `KANVAS_AUTH_OAUTH_CONFIG_FILE`             | Optional               | JSON file containing OAuth login providers; disabled when absent                                                                     |
| `KANVAS_AUTH_SESSION_EXPIRES_IN_SECONDS`    | Optional               | `604800`                                                                                                                             |
| `KANVAS_AUTH_SESSION_UPDATE_AGE_SECONDS`    | Optional               | `86400`                                                                                                                              |
| `KANVAS_DEMO_MODE`                          | Optional               | `true` outside production, `false` in production                                                                                     |
| `KANVAS_DEMO_WORKSPACE_ID`                  | Optional               | Stable local Demo ULID                                                                                                               |
| `KANVAS_DEMO_ACTOR_ID`                      | Optional               | Stable local Demo ULID                                                                                                               |
| `KANVAS_BROWSER_RUNTIME_RELEASE_ID`         | Conditional            | Required canonical ULID when target `browser` is enabled                                                                             |
| `KANVAS_BROWSER_RUNTIME_RELEASE_DIGEST`     | Conditional            | Required SHA-256 when target `browser` is enabled                                                                                    |
| `KANVAS_BROWSER_SESSION_TTL_SECONDS`        | Optional               | `3600`                                                                                                                               |
| `KANVAS_BROWSER_ATTEMPT_LEASE_MS`           | Optional               | `30000`                                                                                                                              |
| `KANVAS_BROWSER_CANDIDATE_LIMIT`            | Optional               | `20`                                                                                                                                 |

SMTP delivery and the development outbox are mutually exclusive. Configuring a
delivery makes verified-email registration available to the Instance Administrator;
it does not open registration by itself. The administrator must also select the email
method in the `account_only` Registration Policy. SMTP is transport-neutral: an
internal relay may omit user/password, while authenticated SMTP must configure both.
The development outbox stores live verification URLs and is therefore created with
mode `0600`; keep it under an ignored local directory and delete it after testing.
The official Compose deployment keeps SMTP optional through an overlay. Create
`deploy/secrets/kanvas_smtp_password`, configure the non-secret SMTP values in
`deploy/.env`, then include both files:

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.smtp.yaml up -d
```

The overlay mounts the password as `/run/secrets/kanvas_smtp_password`; it never
places the SMTP credential in the container environment. Deployments using an
unauthenticated internal relay can supply the same non-secret variables through their
own Compose override while omitting both SMTP user and password-file settings.

Development bootstrap uses `KANVAS_DEV_ADMIN_PASSWORD` (required, 12–128
characters) and the optional values below:

| Variable                       | Default              |
| ------------------------------ | -------------------- |
| `KANVAS_DEV_ADMIN_EMAIL`       | `admin@kanvas.local` |
| `KANVAS_DEV_ADMIN_NAME`        | `Kanvas Admin`       |
| `KANVAS_DEV_ORGANIZATION_SLUG` | `kanvas-local`       |
| `KANVAS_DEV_ORGANIZATION_NAME` | `Kanvas Local`       |
| `KANVAS_DEV_WORKSPACE_SLUG`    | `studio`             |
| `KANVAS_DEV_WORKSPACE_NAME`    | `Kanvas Studio`      |

## Worker variables

| Variable                                            | Necessity             | Default / structure                                                                                      |
| --------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `KANVAS_REDIS_HOST`                                 | Required              | No default                                                                                               |
| `KANVAS_REDIS_PORT`                                 | Optional              | `6379`                                                                                                   |
| `KANVAS_REDIS_DB`                                   | Optional              | `0`; non-negative integer; the Redis endpoint must support the selected database                         |
| `KANVAS_REDIS_PASSWORD`                             | Secret alternative    | Required with no URL or file in production                                                               |
| `KANVAS_REDIS_PASSWORD_FILE`                        | File alternative      | Mounted secret path                                                                                      |
| `KANVAS_WORKER_HEALTH_HOST`                         | Optional              | `127.0.0.1`                                                                                              |
| `KANVAS_WORKER_HEALTH_PORT`                         | Optional              | `3001`                                                                                                   |
| `KANVAS_WORKER_ROLES`                               | Optional              | All roles except `provider-execution` and `agent`; comma-separated bounded set                           |
| `KANVAS_ATTEMPT_LEASE_DURATION_MS`                  | Optional              | `30000`                                                                                                  |
| `KANVAS_ATTEMPT_HEARTBEAT_INTERVAL_MS`              | Optional              | `10000`; must be shorter than the lease                                                                  |
| `KANVAS_ATTEMPT_TIMEOUT_MS`                         | Optional              | `300000`; must not be shorter than the lease                                                             |
| `KANVAS_AGENT_RUN_CONCURRENCY`                      | Optional              | `4`; max `min(32, max(1, KANVAS_DATABASE_CONNECTION_LIMIT - 2))` per Worker                              |
| `KANVAS_RECONCILER_POLL_INTERVAL_MS`                | Optional              | `1000`                                                                                                   |
| `KANVAS_RECONCILER_STALE_AFTER_MS`                  | Optional              | `15000`                                                                                                  |
| `KANVAS_RECONCILER_BATCH_SIZE`                      | Optional              | `20`                                                                                                     |
| `KANVAS_PROVIDER_ADAPTER_KEYS`                      | Conditional           | Defaults to installed HTTP adapters when Provider execution is enabled; explicit list restricts adapters |
| `KANVAS_PROVIDER_ALLOWED_ORIGINS`                   | Optional              | Additional operator restriction on saved API endpoints; comma-separated exact origins                    |
| `KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED`          | Optional              | `true`; explicit `false` disables remote results                                                         |
| `KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS`            | Optional              | Additional exact-origin restriction on remote results                                                    |
| `KANVAS_PROVIDER_ALLOW_HTTP`                        | Optional              | `false`                                                                                                  |
| `KANVAS_PROVIDER_ALLOW_PRIVATE_NETWORKS`            | Optional              | `false`                                                                                                  |
| `KANVAS_PROVIDER_UNSAFE_NETWORK_ACK`                | Conditional           | Required in production when either unsafe network option is true                                         |
| `KANVAS_PROVIDER_MAX_REQUEST_BYTES`                 | Optional              | `16777216`                                                                                               |
| `KANVAS_PROVIDER_MAX_RESPONSE_BYTES`                | Optional              | `33554432`                                                                                               |
| `KANVAS_PROVIDER_FAKE_ADAPTER_ENABLED`              | Development/test only | `false`                                                                                                  |
| `KANVAS_WORKER_DETERMINISTIC_IMAGE_ADAPTER_ENABLED` | Development/test only | `false`                                                                                                  |

### Official standalone image defaults

The standalone image supplies all Worker roles (including Agent and Provider
execution) and the `worker,provider` execution targets. Explicit environment
values override those defaults, including Matrix-transported values. Direct
Server/Worker development processes and separate role images retain their own
component defaults; custom split deployments must set their intended roles.

With real Provider execution enabled, an omitted `KANVAS_PROVIDER_ADAPTER_KEYS`
uses the installed HTTP adapter registry. A supplied list remains a restriction;
blank environment placeholders use the default, and delimiter-only malformed lists
are rejected. This does not install Workspace
Runtime Adapter definitions, configure a Provider, or grant network access.
`KANVAS_PROVIDER_ALLOWED_ORIGINS` optionally restricts the saved Provider API
origins. When omitted, built-in adapters use the endpoint from the validated
execution context; URLs in task input do not select API targets. Blank environment placeholders count as omitted; a nonempty malformed list is
rejected. HTTPS, address checks, DNS pinning and redirect rejection remain
in force. An explicitly configured CONNECT proxy retains its existing role as the
DNS/network trust boundary. Result URL downloads are enabled by default so URL-only
image Providers work without extra deployment setup. They retain HTTPS/address,
redirect, deadline, byte and media validation and do not forward credentials.
`KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS` is an optional separate restriction;
`KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED=false` still explicitly disables them.

The complete image also defaults to production, instance identity `kanvas` and
one trusted internal Nginx hop. An external proxy requires the appropriate explicit
hop count. All explicit values win, including transported deployment values.

With no storage configuration at all, the complete image uses its mounted
`/var/lib/kanvas/objects` directory and the stable profile ID
`01K00000000000000000000020` from previous official templates. No identity is
regenerated on restart. Any nonempty Local/S3/OSS setting opts out of the entire
storage default group; custom and split installations must provide their selected
backend's required fields. Preserve existing profile IDs and volumes on upgrade.

## Storage variables

No Storage variable is necessary for the core control plane. Setting a profile
enables content transfer. Local and S3 variables are mutually exclusive.

| Variable                                  | Necessity                      | Default / structure                                                                      |
| ----------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `KANVAS_STORAGE_KIND`                     | Conditional                    | Inferred when exactly one profile is present; otherwise `local` or `s3`                  |
| `KANVAS_LOCAL_STORAGE_ROOT`               | Conditional                    | Required absolute path for Local Storage                                                 |
| `KANVAS_LOCAL_STORAGE_PROFILE_ID`         | Conditional                    | Required stable ULID for Local Storage                                                   |
| `KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK`   | Conditional                    | Required trust acknowledgement for Local Storage                                         |
| `KANVAS_S3_STORAGE_PROFILE_ID`            | Conditional                    | Required stable ULID for S3                                                              |
| `KANVAS_S3_ENDPOINT`                      | Conditional                    | Required exact origin for S3                                                             |
| `KANVAS_S3_REGION`                        | Conditional                    | Required for S3                                                                          |
| `KANVAS_S3_BUCKET`                        | Conditional                    | Required for S3                                                                          |
| `KANVAS_S3_FORCE_PATH_STYLE`              | Optional                       | `true`                                                                                   |
| `KANVAS_S3_SERVER_SIDE_ENCRYPTION`        | Optional                       | `none`; enum `none`, `AES256`, `aws:kms`                                                 |
| `KANVAS_S3_KMS_KEY_ID`                    | Conditional                    | Required only for `aws:kms`                                                              |
| `KANVAS_S3_STAGING_DIRECTORY`             | Optional                       | Absolute bounded staging path                                                            |
| `KANVAS_S3_ACCESS_KEY_ID`                 | Secret alternative             | Direct static credential                                                                 |
| `KANVAS_S3_SECRET_ACCESS_KEY`             | Secret alternative             | Required with direct access key                                                          |
| `KANVAS_S3_SESSION_TOKEN`                 | Secret alternative             | Optional direct session token                                                            |
| `KANVAS_S3_ACCESS_KEY_ID_FILE`            | Optional production credential | Required with secret-key file                                                            |
| `KANVAS_S3_SECRET_ACCESS_KEY_FILE`        | Optional production credential | Required with access-key file                                                            |
| `KANVAS_S3_SESSION_TOKEN_FILE`            | Optional                       | Mounted session-token file                                                               |
| `KANVAS_MODEL_RESOURCE_MAX_INPUT_BYTES`   | Optional                       | `2147483648`; bounded model upload/download size                                         |
| `KANVAS_MODEL_RESOURCE_IMPORT_TTL_MS`     | Optional                       | `86400000`; model import review-session lifetime                                         |
| `KANVAS_MODEL_IMPORT_POLL_INTERVAL_MS`    | Optional                       | `1000`; Worker import-claim interval                                                     |
| `KANVAS_MODEL_IMPORT_LEASE_MS`            | Optional                       | `3600000`; must exceed the download timeout by at least 30000 ms                         |
| `KANVAS_MODEL_IMPORT_DOWNLOAD_TIMEOUT_MS` | Optional                       | `3300000`; bounded remote model download deadline                                        |
| `KANVAS_MODEL_IMPORT_PROXY_URL`           | Optional                       | Exact deployment-owned HTTP(S) CONNECT proxy origin; ambient proxy variables are ignored |
| `KANVAS_S3_UNSAFE_HTTP_ACK`               | Conditional                    | Required for production HTTP S3 endpoints                                                |
| `KANVAS_STORAGE_USER_IMPORT_TTL_MS`       | Optional                       | `3600000`                                                                                |
| `KANVAS_STORAGE_VERIFICATION_LEASE_MS`    | Optional                       | `120000`                                                                                 |
| `KANVAS_STORAGE_CLEANUP_GRACE_MS`         | Optional                       | `3600000`                                                                                |
| `KANVAS_STORAGE_MAX_INPUT_BYTES`          | Optional                       | `134217728`                                                                              |
| `KANVAS_STORAGE_MAX_IMAGE_WIDTH`          | Optional                       | `32768`                                                                                  |
| `KANVAS_STORAGE_MAX_IMAGE_HEIGHT`         | Optional                       | `32768`                                                                                  |
| `KANVAS_STORAGE_MAX_IMAGE_PIXELS`         | Optional                       | `134217728`                                                                              |
| `KANVAS_STORAGE_MAX_DECODED_BYTES`        | Optional                       | `536870912`                                                                              |
| `KANVAS_STORAGE_MAX_EXPANSION_RATIO`      | Optional                       | `2048`                                                                                   |
| `KANVAS_STORAGE_GC_POLL_INTERVAL_MS`      | Optional Worker value          | `5000`                                                                                   |
| `KANVAS_STORAGE_GC_CLAIM_LEASE_MS`        | Optional Worker value          | `30000`                                                                                  |
| `KANVAS_STORAGE_GC_BASE_RETRY_MS`         | Optional Worker value          | `5000`                                                                                   |
| `KANVAS_STORAGE_GC_MAX_RETRY_MS`          | Optional Worker value          | `300000`                                                                                 |

Artifact previews are scalar tuning values because they are independently
overridable and already form a validated `ArtifactPreviewConfig` component:

| Variable                                           | Default     |
| -------------------------------------------------- | ----------- |
| `KANVAS_ARTIFACT_PREVIEW_MODE`                     | `on_demand` |
| `KANVAS_ARTIFACT_PREVIEW_FALLBACK_ON_MISS`         | `true`      |
| `KANVAS_ARTIFACT_PREVIEW_WIDTH`                    | `640`       |
| `KANVAS_ARTIFACT_PREVIEW_HEIGHT`                   | `640`       |
| `KANVAS_ARTIFACT_PREVIEW_QUALITY`                  | `80`        |
| `KANVAS_ARTIFACT_PREVIEW_EFFORT`                   | `4`         |
| `KANVAS_ARTIFACT_PREVIEW_MAX_SOURCE_BYTES`         | `41943040`  |
| `KANVAS_ARTIFACT_PREVIEW_WORKER_CONCURRENCY`       | `2`         |
| `KANVAS_ARTIFACT_PREVIEW_GENERATION_ATTEMPTS`      | `3`         |
| `KANVAS_ARTIFACT_PREVIEW_GENERATION_RETRY_MS`      | `5000`      |
| `KANVAS_ARTIFACT_PREVIEW_CLEANUP_POLL_INTERVAL_MS` | `30000`     |
| `KANVAS_ARTIFACT_PREVIEW_CLEANUP_RETRY_MS`         | `30000`     |

## Web build variables

`KANVAS_WEB_DEV_API_ORIGIN` is optional and defaults to
`http://127.0.0.1:3000`. It is consumed only by the Vite development server.
`KANVAS_WEB_SOURCEMAP` defaults to `false`; set it to `true` only when the
deployment has a private Source Map upload pipeline. Only `VITE_` values are
exposed to browser code.

Browser capabilities and their exact Implementation, Runtime Adapter, and
optional Model Resource revisions are loaded only from the authenticated
Browser Runtime Manifest. There are no capability-specific Web build flags or
model paths. The Web build admits only its bundled runtime assets; model bytes
are served from the active Model Resource through local or S3-compatible
Storage.

## Command-scoped variables

These variables configure one administrative or verification command. They do
not belong in long-running Server, Worker or Web environments.

### Recovery and local database tools

| Variable                                        | Necessity / default                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `KANVAS_DATABASE_SOCKET`                        | Optional local preflight and integration-test socket; absent uses TCP    |
| `KANVAS_DEPLOYMENT_ID`                          | Required by backup and recovery; stable bounded deployment identity      |
| `KANVAS_CONFIG_MANIFEST_DIGEST`                 | Required by backup and recovery; canonical configuration SHA-256         |
| `KANVAS_RECOVERY_AUTHENTICATION_REF_HASH`       | Required by backup and recovery; canonical redacted authentication hash  |
| `KANVAS_RECOVERY_OPERATOR_ID`                   | Required by backup and recovery; bounded operator identity               |
| `KANVAS_MIGRATIONS_DIRECTORY`                   | Optional absolute override; defaults to this release's migration folder  |
| `KANVAS_APP_IMAGE`                              | Required by backup/recovery; canonical digest or digest-pinned reference |
| `KANVAS_WEB_IMAGE`                              | Required by backup/recovery; canonical digest or digest-pinned reference |
| `KANVAS_MYSQL_IMAGE`                            | Required by backup/recovery; canonical digest or digest-pinned reference |
| `KANVAS_REDIS_IMAGE`                            | Required by backup/recovery; canonical digest or digest-pinned reference |
| `KANVAS_PROVIDER_SETTINGS_WORKSPACE_ID`         | Required by `bootstrap:provider-settings-policy`; canonical Workspace ID |
| `KANVAS_PROVIDER_SETTINGS_ACTOR_ID`             | Required by `bootstrap:provider-settings-policy`; canonical actor ID     |
| `KANVAS_OPENAI_IMAGES_ROUTE_POLICY_REVISION_ID` | Optional Demo-bootstrap override when no current Provider route exists   |

`KANVAS_BOOTSTRAP_WORKSPACE_ID` optionally selects the target Workspace for
the one-shot default Catalog registration command. It defaults to the local
development Workspace ID. Registration publishes read-only recommendations; a user
still chooses and confirms each Capability or Model Resource installation.

Recovery identities remain separate scalars because operators rotate and
audit them independently. Provider policy uses a dedicated command rather
than a permanent application environment block.

### Provider preparation

`prepare:openai-images` verifies an API key and emits the following bounded
bootstrap inputs. The control plane is disabled when its enable flag is absent
or `false`.

| Variable                                          | Necessity / default                              |
| ------------------------------------------------- | ------------------------------------------------ |
| `KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED`      | Optional; `false`                                |
| `KANVAS_OPENAI_IMAGES_DEPLOYMENT_REFERENCE`       | Required when enabled; `deployment://` reference |
| `KANVAS_OPENAI_IMAGES_SECRET_FINGERPRINT`         | Required when enabled; canonical SHA-256         |
| `KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATION_DIGEST` | Required when enabled; canonical SHA-256         |
| `KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATED_AT`      | Required when enabled; non-future ISO timestamp  |
| `KANVAS_OPENAI_IMAGES_MODEL_ID`                   | Optional; `gpt-image-1.5`                        |

`prepare:generation-tasks-images` accepts the API-key path, optional secret-map
path and validation task ID as command arguments. These variables only select
or describe the generated Provider definition:

| Variable                                                    | Necessity / default                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `KANVAS_GENERATION_TASKS_VALIDATION_TASK_ID`                | Required only when not passed as an argument                      |
| `KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED`      | Optional; `false`                                                 |
| `KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND`                | Optional; `tokenhub`; enum `tokenhub`, `newapi`                   |
| `KANVAS_GENERATION_TASKS_IMAGES_PROVIDER_KEY`               | Optional; defaults to the preset                                  |
| `KANVAS_GENERATION_TASKS_IMAGES_MODEL_ID`                   | Optional; `gpt-image-2`                                           |
| `KANVAS_GENERATION_TASKS_IMAGES_REGION_CODE`                | Optional; `us` for TokenHub, `private` for NewAPI                 |
| `KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN`                 | Optional; `https://us-api.tokenhub.com`; exact HTTPS origin       |
| `KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE`       | Optional during preparation; generated from the Provider key      |
| `KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT`         | Required by enabled bootstrap; generated by preparation           |
| `KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST` | Required by enabled bootstrap; generated by preparation           |
| `KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT`      | Required by enabled bootstrap; generated non-future ISO timestamp |
| `KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT`        | Required while enabled; positive bounded decimal                  |
| `KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE` | Required while enabled; bounded evidence reference                |
| `KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST`    | Required while enabled; canonical SHA-256                         |
| `KANVAS_GENERATION_TASKS_RESULT_ORIGINS`                    | Optional preparation allowlist; empty comma-separated list        |

These fields stay flat because each command manages exactly one Provider
definition and validates every field independently. Multi-Provider secret and
policy maps use the structured shared variables documented above.

### Canary and test harnesses

| Variable                                 | Necessity / default                                             |
| ---------------------------------------- | --------------------------------------------------------------- |
| `KANVAS_CANARY_BASE_URL`                 | Optional; `http://127.0.0.1:3000`                               |
| `KANVAS_PROVIDER_CANARY_WORKER_BASE_URL` | Optional; `http://127.0.0.1:3002`                               |
| `KANVAS_PROVIDER_CANARY_OUTPUT_ROOT`     | Optional; ignored local `artifacts/atom-foundation-provider-v1` |
| `KANVAS_PROVIDER_CANARY_OBSERVE_MS`      | Optional; `5000`, bounded to 0–60000                            |
| `KANVAS_PROVIDER_CANARY_WORKFLOWS`       | Optional; all built-in image Provider canaries                  |

The direct Generation Tasks canary is intentionally separate from the governed
Provider bootstrap path:

| Variable                                  | Necessity / default                                       |
| ----------------------------------------- | --------------------------------------------------------- |
| `GENERATION_TASKS_API_KEY`                | Required Secret for the direct canary                     |
| `GENERATION_TASKS_API_ORIGIN`             | Optional; `https://us-api.tokenhub.com`                   |
| `GENERATION_TASKS_ASSET_ORIGIN`           | Required exact result-asset origin                        |
| `GENERATION_TASKS_PROVIDER_KEY`           | Optional; `tokenhub`                                      |
| `GENERATION_TASKS_PRESET_KIND`            | Optional; `tokenhub`; enum `tokenhub`, `newapi`           |
| `GENERATION_TASKS_MODEL_ID`               | Optional; `gpt-image-2`                                   |
| `GENERATION_TASKS_ALLOW_PRIVATE_NETWORKS` | Optional; `false`                                         |
| `GENERATION_TASKS_TASK_ID`                | Optional existing task to observe instead of creating one |

Integration variables are test-harness inputs only. They have no application
default and are deliberately absent from component examples:

| Variable                                     | Necessity / default                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| `KANVAS_DATABASE_INTEGRATION`                | Optional direct-test opt-in; absent skips the guarded suite |
| `KANVAS_DATABASE_DISPOSABLE_INTEGRATION`     | Required destructive-test acknowledgement; exact value `1`  |
| `KANVAS_INTEGRATION_DATABASE_SOCKET`         | Optional disposable harness admin socket; absent uses TCP   |
| `KANVAS_INTEGRATION_DATABASE_ADMIN_USER`     | Optional disposable harness administrator; `root`           |
| `KANVAS_INTEGRATION_DATABASE_ADMIN_PASSWORD` | Optional disposable harness administrator password; empty   |
| `KANVAS_TEST_S3_ENDPOINT`                    | Required only for the S3 adapter integration suite          |
| `KANVAS_TEST_S3_ACCESS_KEY_ID`               | Required only for the S3 adapter integration suite          |
| `KANVAS_TEST_S3_SECRET_ACCESS_KEY`           | Required only for the S3 adapter integration suite          |

## Environment-first deployment inputs

| Variable                           | Meaning                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KANVAS_DATABASE_URL`              | MySQL URL with percent-encoded credentials and database path; optional `?ssl=true` enables verified TLS; excludes split connection settings                    |
| `KANVAS_DATABASE_SSL_CA_FILE`      | Optional mounted private CA certificate; enables verified MySQL TLS; omit for system trust roots with `?ssl=true`                                              |
| `KANVAS_REDIS_URL`                 | `redis://` or verified-TLS `rediss://`, optional ACL username, password and logical database path; excludes split Redis settings and query parameters          |
| `KANVAS_REDIS_TLS_CA_FILE`         | Optional mounted private CA certificate; enables verified Redis TLS                                                                                            |
| `KANVAS_DB_MIGRATION_MODE`         | Container entrypoint: `auto` migrates then checks; `check` only checks. Default `auto` for `all`, `check` for separate Server/Worker roles                     |
| `KANVAS_AUTH_OAUTH_CONFIG_JSON`    | OAuth provider array, same fields as file configuration; each provider supplies either clientSecret or clientSecretFile; mutually exclusive with CONFIG_FILE   |
| `KANVAS_PROVIDER_KEK_MAP_JSON`     | Secret JSON map from version to Base64-encoded 32-byte key; mutually exclusive with KEK_MAP_FILE; preserve old versions for pinned credentials                 |
| `KANVAS_S3_KEY_PREFIX`             | Optional stable directory prefix such as kanvas-test/; applies to reads, writes, deletes, probes and signed URLs; never change for an existing Storage Profile |
| `KANVAS_DEFAULT_CATALOG_DIRECTORY` | Optional path to the bundled default Catalog; production Server image sets this explicitly                                                                     |

Unknown URL query parameters are rejected rather than silently ignored. TLS never
disables certificate verification. AWS ambient static credential
variables are not a supported configuration interface; use explicit Kanvas S3
credentials or workload identity. Secret values must not appear in CI output.

The legacy company Matrix transport uses the reserved `KANVAS_CI_B64_` prefix
(for example `KANVAS_CI_B64_AUTH_OAUTH_CONFIG_JSON`, `KANVAS_CI_B64_DB_MIGRATION_MODE`,
`KANVAS_CI_B64_WORKER_ROLES` and `KANVAS_CI_B64_ENABLED_EXECUTION_TARGETS`). These are unpadded Base64
transport values decoded by the image, not separate product settings or encryption.
Normal deployments inject ordinary variables directly. `KANVAS_TEST_IMAGE` is only
the local Docker lifecycle test's image selector, not an application setting.

## Aliyun OSS native provider

Select `KANVAS_STORAGE_KIND=oss`. Do not supply S3 or local profile variables.
The prefix is application-owned and must not have other writers or lifecycle
rules that delete metadata. The provider requires an unversioned Bucket and
uses native OSS requests; it does not use the S3 API.

| Variable                        | Meaning                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `KANVAS_OSS_STORAGE_PROFILE_ID` | Stable canonical ULID                                        |
| `KANVAS_OSS_ENDPOINT`           | Exact HTTPS origin                                           |
| `KANVAS_OSS_REGION`             | OSS region                                                   |
| `KANVAS_OSS_BUCKET`             | Existing Bucket                                              |
| `KANVAS_OSS_KEY_PREFIX`         | Required dedicated prefix, for example kanvas-test/          |
| `KANVAS_OSS_ACCESS_KEY_ID`      | Secret-backed environment access key                         |
| `KANVAS_OSS_ACCESS_KEY_SECRET`  | Secret-backed environment access secret                      |
| `KANVAS_OSS_SECURITY_TOKEN`     | Optional STS token; roll Pods when static credentials expire |
| `KANVAS_OSS_STAGING_DIRECTORY`  | Optional absolute temporary directory; defaults to OS temp   |

Inside the prefix, `objects/` holds content and `deletions/` holds durable
non-reuse fences. Fences are retained permanently; do not delete them or enable
expiration policies for them. Maintenance workers sweep one bounded page of
fences per GC iteration to remove ambiguous late uploads. Bucket permissions
must include listing and object reads/writes/deletes within the managed prefix.
The original object identity is never reusable after deletion.

### Provider result download limits

Binary result transfers also have a 60-second per-address ceiling and a
15-second progress window requiring an average of at least 1024 bytes/second.
Low progress and address timeouts allow safe GET failover to another validated
address within the original deadline (at most three addresses). Small completed
files are accepted immediately. These transport defaults can be overridden by
the typed `ProviderResultTimeouts` options; they do not extend the task deadline.
The Provider reconciler processes up to four candidates concurrently so a slow
download does not hold the entire batch. Lease ownership still governs adoption.

Provider invocation ownership renews within the existing Attempt deadline. Renewal
never extends `KANVAS_ATTEMPT_TIMEOUT_MS`. Losing ownership stops ongoing I/O.
Binary result GETs additionally use the phase limits below; receiving nonempty
body data resets only the idle timer. Model-generation POSTs are never retried by
this transport. Defaults are initial operational bounds, configurable by deployment,
not throughput guarantees; each limit must fit within the Attempt timeout.

| Variable                                       | Default (capped by Attempt timeout) | Meaning                                |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------- |
| `KANVAS_PROVIDER_RESULT_CONNECT_TIMEOUT_MS`    | `20000`                             | TCP, proxy and TLS establishment       |
| `KANVAS_PROVIDER_RESULT_HEADERS_TIMEOUT_MS`    | `60000`                             | Wait for response headers              |
| `KANVAS_PROVIDER_RESULT_FIRST_BYTE_TIMEOUT_MS` | `60000`                             | Wait for the first nonempty body chunk |
| `KANVAS_PROVIDER_RESULT_IDLE_TIMEOUT_MS`       | `60000`                             | Silence between nonempty body chunks   |

Before returning original-file links for failed tasks, Server applies the same current
download rules to retained result evidence (including historical tasks). Configure
`KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED` and `KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS`
consistently for Server and Worker; these also govern fallback link visibility.
Links remain limited to authorized readers of the current failed attempt.

Workspace owners and administrators can request result recovery for another user's
failed task from task records. Recovery retains the real operator's authority and
revalidates it at admission, worker claim and commit; it does not impersonate the
task owner or grant access to private conversation files. The task owner can see
the shared recovery records and download recovered files without requesting recovery
again. Active requests are reused, and completed results are skipped on later retries.
No model generation is repeated and the original failure record remains unchanged.

Runtime settings automatically use the activated administrator configuration. Before
activation, result downloads retain the deployment origin rules. Saving and activating
settings takes effect on the next download without another environment switch or
process restart. `KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED=false` remains an
independent emergency disable. HTTPS, address and redirect protections still apply.
An unavailable configuration read is an error, not permission to use legacy defaults.
The former `KANVAS_PROVIDER_RESULT_POLICY_SOURCE` switch has been removed; existing
values are ignored and may be removed from deployment configuration.

For staged activation, verification and rollback, follow the [runtime configuration governance runbook](plans/runtime-configuration-governance-implementation.md#deployment-and-activation-runbook).
