# Model Service Control Plane V1

Status: implemented and verified as the V1 baseline

## 1. Decision

Kanvas exposes only three concepts in the management UI:

- **Provider**: one configured API connection.
- **Model**: one canonical model identity used inside Kanvas.
- **Capability**: one business operation that may select a configured model.

The management surface is one **Model Services** page with two tabs:

- `Providers`
- `Models`

Capability configuration remains a separate page because capabilities can also
run locally or on Workers without a Provider model.

The canonical Model slug is unique inside a Workspace. Multiple Provider models
may reference the same canonical Model. They do not create duplicate Models.

## 2. V1 non-goals

- No weighted routing, priority routing, automatic failover, or retry across
  Providers.
- No Provider groups.
- No raw JSON mapping in the normal journey.
- No automatic mutation of active Model, pricing, or Capability configuration
  after a models.dev sync.
- No new public concepts for Agent-specific models.

V1 always pins one Provider model deployment when an application or Capability
selects a Model.

## 3. User journeys

### 3.1 Configure a Provider

1. Open `Model Services / Providers`.
2. Choose a built-in Provider definition with its name and logo.
3. Enter a display name, optional custom endpoint, and credential.
4. Validate the connection.
5. Save the Provider connection.
6. Fetch its upstream model catalog.
7. Review and map upstream models before publishing them.

Creating a Provider does not require choosing a model. Importing models is a
separate operation after the connection is valid.

### 3.2 Import and map Provider models

1. Fetch models through the Provider catalog API.
2. Store an immutable catalog snapshot.
3. Show upstream model ID, Provider metadata, inferred canonical Model, and
   confidence/source.
4. Allow `Select all filtered results`.
5. Map each selected upstream model to either:
   - an existing canonical Model slug; or
   - a new draft Model prefilled from the reference catalog.
6. Review mapping, capability, limit, and pricing readiness.
7. Publish selected mappings.

The visual mapping direction is always:

`Kanvas Model slug -> Provider upstream model ID`

The normal UI uses a two-column mapping editor. JSON is advanced diagnostics
only and is not required for configuration.

### 3.3 Create or edit a Model

1. Open `Model Services / Models`.
2. Search the internal models.dev reference snapshot first.
3. Select a reference to prefill Model metadata or start manually.
4. Confirm the unique canonical slug.
5. Review display name, family, modalities, limits, and supported model
   operations.
6. Select one discovered Provider model to attach.
7. Review Provider-specific pricing and overrides.
8. Publish the Model and the single selected deployment.

If the slug already exists, the action changes from `Create Model` to
`Add Provider`. It never creates a second Model with the same slug.

### 3.4 Select a Model from an application or Capability

1. Select a canonical Model.
2. Select one ready Provider deployment serving that Model.
3. Pin the deployment revision for the new run.

Agent default selection is an application setting. It consumes the same Model
and deployment records and does not own another Model configuration.

## 4. Provider definitions

Executable Provider behavior stays in a built-in code registry rather than a
database-configured adapter system. A definition contains:

- `slug`
- localized display name
- logo asset
- protocol/adapter key
- default endpoint
- whether a custom endpoint is allowed
- credential field labels
- catalog discovery strategy
- connection probe strategy
- supported API surfaces

models.dev may enrich names, documentation links, logos, and catalog reference
metadata. It cannot make a Provider executable. An adapter and probe must exist
in Kanvas code before the Provider can be selected.

Provider credentials continue to use `Credential` and immutable
`SecretVersion`. They never enter Model, reference, catalog, DTO, log, or audit
documents.

## 5. Domain model

### 5.1 `canonical_model` — new stable identity

| Column                      | Rule                                     |
| --------------------------- | ---------------------------------------- |
| `id`                        | ULID primary key                         |
| `workspace_id`              | Workspace owner                          |
| `slug`                      | Canonical internal slug                  |
| `lifecycle_status`          | `draft`, `active`, `disabled`, `revoked` |
| `source_kind`               | `models_dev`, `provider`, `manual`       |
| `source_reference`          | Optional models.dev canonical key        |
| `version`                   | Optimistic concurrency                   |
| audit timestamps/principals | Required                                 |

Invariant:

`UNIQUE (workspace_id, slug)`

Slug comparison is exact, normalized lowercase ASCII. A slug is immutable after
the Model becomes active.

### 5.2 `model_profile_revision` — reuse, make Provider-independent

Add `canonical_model_id`. The single internal Model Profile v1 contains Model
facts and operation parameter evidence. Provider preset, upstream model ID, and
API surface remain on the deployment and route snapshot:

```json
{
  "schemaVersion": 1,
  "model": {
    "slug": "openai/gpt-5.6-terra",
    "displayName": "GPT-5.6 Terra",
    "family": "gpt-5.6",
    "description": "...",
    "inputModalities": ["text", "image"],
    "outputModalities": ["text"],
    "contextWindow": 1100000,
    "maximumOutputTokens": 128000
  },
  "operations": {
    "text.generate": {
      "parameters": [],
      "evidence": []
    }
  },
  "sources": []
}
```

Remove `providerPreset` and `providerModelId` from Model profile identity. They
belong to the Provider model.

Invariants:

- one immutable revision number per canonical Model;
- published revisions are never edited;
- a models.dev update creates a reviewable draft revision and never replaces the
  published revision automatically.

### 5.3 `provider_model` — discovered upstream identity and mapping

| Column                | Rule                                                    |
| --------------------- | ------------------------------------------------------- |
| `id`                  | ULID primary key                                        |
| `workspace_id`        | Workspace owner                                         |
| `provider_setting_id` | Configured Provider connection                          |
| `upstream_model_id`   | Exact ID sent to the Provider                           |
| `canonical_model_id`  | Nullable until mapped                                   |
| `catalog_snapshot_id` | Snapshot that most recently confirmed it                |
| `mapping_source`      | `models_dev`, `provider`, `manual`                      |
| `mapping_confidence`  | `exact`, `suggested`, `manual`                          |
| `lifecycle_status`    | `discovered`, `mapped`, `active`, `disabled`, `removed` |
| `last_seen_at`        | Last authoritative catalog observation                  |
| `version`             | Optimistic concurrency                                  |

Invariants:

- `UNIQUE (workspace_id, provider_setting_id, upstream_model_id)`;
- many Provider models may reference the same `canonical_model_id`;
- one Provider upstream ID cannot reference two canonical Models;
- `canonical_model_id` may change only before the Provider model becomes active;
- disappearance from a new catalog marks a review state and does not silently
  remove an active deployment.

### 5.4 `model_deployment` — published Provider revisions

`provider_model_record_id` relates a deployment to its discovered
`provider_model`. `provider_model_id` is the denormalized exact upstream wire ID
pinned into the immutable deployment generation; execution never follows a
mutable catalog alias.

A deployment owns:

- Provider endpoint and upstream model ID through `provider_model`;
- the pinned canonical `model_profile_revision`;
- API surface and executable adapter through the route revision;
- lifecycle generation;
- Provider-specific pricing through `pricing_revision`.

The current deployment generation mechanism remains the source of truth for
running tasks. Existing runs retain their pinned generation after an edit.

### 5.5 `pricing_revision` — reuse, Provider-specific

Pricing always belongs to a Provider model deployment, not to the canonical
Model. models.dev values are defaults with a source and observation date.

Publishing requires one of the supported billing modes:

- fixed per request;
- metered;
- Provider-reported.

An incomplete or unverified price prevents the deployment from being selected
for new paid runs.

### 5.6 Capability records — reuse and keep independent

Keep `capability_contract_revision`, `capability_implementation_revision`, and
`capability_binding` independent from Models.

A Provider-backed Capability route selects exactly one `model_deployment` in
V1. Parameter compilation order is:

1. Provider adapter maps canonical parameter keys to wire fields.
2. Model profile declares which canonical parameters the operation supports.
3. Capability binding narrows allowed values and supplies defaults.
4. Caller values are validated against the compiled intersection.

Capability configuration never copies raw Provider request fields.

## 6. Availability rules

A canonical Model is visible in the Models list after it exists, including draft
or unavailable states.

A Model is selectable for a new application run only when all are true:

- canonical Model lifecycle is `active`;
- a published Model profile revision exists;
- the selected Provider connection is active and validated;
- its active SecretVersion is available;
- the Provider model mapping is `active`;
- an active Model deployment generation exists;
- the pricing revision is published and compatible with settlement;
- the selected Model operation supports the requested Capability/API surface;
- the budget account can reserve the configured maximum charge.

Importing a Provider catalog alone satisfies none of these selection gates.

## 7. models.dev reference synchronization

### 7.1 Runtime boundary

The browser and request path never depend directly on models.dev. Kanvas uses a
validated last-known-good internal snapshot.

The sync command reads the current models.dev `models.json` and `api.json`,
validates their complete projection, and assigns a content-derived source
revision. Request handling never calls models.dev directly.

### 7.2 `model_reference_snapshot` — new append-only snapshot

| Column               | Rule                                        |
| -------------------- | ------------------------------------------- |
| `id`                 | ULID primary key                            |
| `revision`           | Monotonic instance revision                 |
| `source_revision`    | models.dev commit or release identifier     |
| `source_digest`      | SHA-256 of normalized projection            |
| `reference_document` | Validated compact Provider/Model projection |
| `fetched_at`         | Network observation time                    |
| `published_at`       | Time accepted as last-known-good            |

The compact projection contains:

- Provider display metadata and logo references;
- canonical Model metadata keyed by models.dev model key;
- Provider model IDs and their canonical `base_model` key;
- Provider-specific price, limit, modality, lifecycle, and API-shape overrides.

### 7.3 Sync behavior

1. Run daily from the deployment scheduler.
2. Validate the complete projection before writing.
3. Publish one immutable snapshot atomically, replaying the same content hash.
4. Keep serving the previous snapshot if fetch or validation fails.
5. Never update active Workspace Model or pricing revisions automatically.
6. Keep executable Provider logos as reviewed internal assets; do not hotlink
   them at runtime.

The deployment scheduler invokes this idempotent command once per day:

```bash
pnpm sync:model-reference -- --actor-principal-id <service-principal-ulid>
```

Kanvas does not run an in-process timer. Scheduling belongs to the deployment
environment so restarts and horizontal replicas cannot create duplicate local
timers. A failed command exits non-zero and leaves the last published snapshot
unchanged.

## 8. API shape

Reuse current Provider Settings lifecycle routes. Add only the missing Model and
mapping resources.

### Provider catalog and mapping

- `POST /api/v1/provider-settings/{id}/model-catalog-refreshes`
- `GET /api/v1/provider-settings/{id}/model-catalog-review`
- `PATCH /api/v1/provider-settings/{id}/provider-models/{providerModelId}`
  - set canonical Model mapping while discovered/mapped;
  - optimistic version required.
- `POST /api/v1/provider-settings/{id}/provider-model-publications`
  - atomically publish selected mappings, deployments, prices, and audit facts.

### Models

- `GET /api/v1/models`
- `POST /api/v1/models`
- `GET /api/v1/models/{id}`
- `PATCH /api/v1/models/{id}`
- `POST /api/v1/models/{id}/publications`
- `POST /api/v1/models/{id}/disablement`

Normal responses expose business fields only. They do not expose digests,
adapter keys, API surfaces, SecretVersion IDs, route documents, or raw mapping
JSON.

## 9. UI information architecture

### `Model Services / Providers`

Table columns:

- logo and display name;
- Provider type;
- lifecycle/validation status;
- last test latency;
- imported/mapped/active Model counts;
- budget status;
- last updated;
- test, import models, disable, edit.

Do not show priority, weight, group, or Provider balance in V1.

### `Model Services / Models`

Table columns:

- manufacturer logo, display name, canonical slug;
- pricing readiness;
- linked Providers;
- input/output modalities;
- context window and maximum output;
- lifecycle;
- reference source and last review;
- edit, add Provider, disable.

### Create/edit drawers

- Use the existing Kanvas settings overlay and field components.
- Provider selector uses built-in logos and searchable definitions.
- Model form searches the internal models.dev snapshot automatically.
- Prefilled fields display their source and remain editable.
- Provider model mapping is visual-first.
- Destructive or route-affecting publication includes an exact preview.

## 10. Implemented baseline

The public baseline contains the completed control plane rather than its
development migration sequence:

- `canonical_model`, `provider_model`, immutable Model profile revisions,
  deployment generations and pricing revisions are present in
  `0000_initial_schema.sql`;
- Provider catalog refresh creates reviewable snapshots and never mutates active
  mappings automatically;
- route compilation and Agent selection pin the same Provider deployment facts;
- the Model Services UI owns Provider discovery and canonical Model mapping;
- no dual-write, heuristic alias backfill or temporary compatibility read is
  part of the public baseline.

Future released schema changes append reviewed migrations. They do not rewrite
the published initial baseline.

## 11. Acceptance criteria

- Two Providers with different upstream IDs can reference one canonical Model
  slug and produce one Model row.
- Duplicate canonical Model slug creation is rejected.
- One Provider upstream ID cannot map to two canonical Models.
- Imported but unmapped models are not selectable.
- Mapped models without published pricing are not selectable for paid runs.
- V1 selection pins exactly one Provider deployment and performs no automatic
  failover.
- A models.dev outage does not affect Provider calls or Model selection.
- A models.dev sync never changes active configuration without review.
- Capability parameter compilation rejects fields unsupported by the selected
  Model operation or Provider adapter.
- Provider secrets never appear in Model/reference DTOs, logs, snapshots, or
  audit details.
- Running tasks retain their pinned deployment, profile, price, credential, and
  budget facts after edits.
- The normal UI contains no raw JSON, internal IDs, digests, or adapter keys.
