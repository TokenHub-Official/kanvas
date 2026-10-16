# Capability Control Plane V1

- Status: Implemented first-release control plane
- Date: 2026-08-31
- Goal: Separate model resources, capability semantics, execution implementations, and Workspace routing into independently maintainable, auditable, and replayable control planes.
- Related documents: [CAPABILITIES.md](CAPABILITIES.md), [CAPABILITY-AUTHORING-DECLARATION-V1.md](CAPABILITY-AUTHORING-DECLARATION-V1.md), and [WORKFLOW-EXECUTION.md](WORKFLOW-EXECUTION.md)

Implementation status as of 2026-08-31:

- one bilingual Catalog Package registers Capability and Model Resource
  recommendations plus the built-in Runtime Adapter registry; Capability Definitions,
  Implementations, Bindings, Workflows, Skills, and model bytes require an explicit
  user installation or authoring action;
- model resources enter through Catalog, stable HTTPS URL, or local upload and are
  analyzed before one atomic publication through Local or S3-compatible Storage;
- Browser and Worker execution resolve exact Adapter, Implementation, and optional
  ModelResource Revisions rather than model- or capability-specific process settings;
- Workflow, Agent `capability.search` / `capability.invoke`, and Canvas consume the
  same persisted capability authority without storing lower-layer identities;
- public Contract replacement is not an implemented first-release administration path;
  immutable Revisions and pinned Workflow/Run facts preserve the boundary required for
  a future evolution protocol;
- updating a model, service, Adapter, or mapping never silently rewrites an existing
  Workflow, Implementation, or Run.

## 1. Decision

Kanvas already has a reliable execution fact chain:

```text
CapabilityContractRevision
-> CapabilityImplementationRevision
-> CapabilityBinding
-> WorkflowRun / CapabilityRun / Attempt
```

V1 keeps this chain. It adds the missing maintenance control planes above it and moves model release facts out of code, deployment variables, and ad hoc Implementation configuration.

```text
CapabilityDefinition
|-- CapabilityDeclarationRevision  # names, descriptions, catalog, semantic ports
`-- CapabilityContractRevision     # executable input and output constraints

ModelResource
`-- ModelResourceRevision          # package, digest, license, format, resource manifest

CapabilityImplementationRevision
|-- ModelResourceRevision          # optional immutable model release
`-- Adapter / Execution Target / Configuration

CapabilityBinding                  # Workspace enablement, order, route, parameter policy
```

Model services, model resources, and capabilities are separate concepts:

| Object         | Answers                                                                            | Does not own                                         |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Model service  | Which Provider, Endpoint, Credential, pricing, and protocol invoke a remote model? | Business capability names and input/output semantics |
| Model resource | Which immutable model package does a Browser or Worker load?                       | Capability routing and user-facing semantics         |
| Capability     | What can a user, Agent, or Workflow do, and what are its inputs and outputs?       | Provider, URL, Storage key, or Credential            |

## 2. Gaps addressed

1. `capability_contract_revision`, `capability_implementation_revision`, and `capability_binding` existed without a stable `CapabilityDefinition` maintenance aggregate.
2. Workflow names, descriptions, parameter labels, and semantic ports were projected from first-party Application profiles instead of persisted Declarations.
3. Browser and Worker model releases were admitted through frontend constants or process environment configuration, so administrators had no model-resource directory.
4. The Execution Routes page could update existing Bindings but could not create, revise, or archive capability definitions.
5. Agent ToolView and Workflow Catalog did not share one published Declaration authority.

## 3. Domain boundaries

### 3.1 CapabilityDefinition

A stable business identity. Keys should use `<media>.<domain>.<action>` where practical. It stores only:

- Workspace and stable key;
- `active | archived` lifecycle;
- optimistic concurrency version;
- references to the current published Contract and Declaration Revisions;
- creation, update, and audit facts.

Archiving preserves immutable Revisions and historical Runs. An archived Definition is excluded from new discovery, Workflow publication, and Binding creation.

### 3.2 CapabilityDeclarationRevision

An immutable declaration for people and Agent/Workflow discovery, using `kanvas.capability-declaration/v1`:

- localized names, descriptions, category, and tags;
- source type and maturity;
- parameter label, description, semantic type, editor, exposure, and source policy;
- output label, description, semantic type, primary-output flag, visibility, and bundle;
- an exact `CapabilityContractRevision` reference.

Changing a name or description publishes another Declaration Revision. Persisted Workflow authoring facts are not silently rewritten by later catalog edits.

### 3.3 CapabilityContractRevision

The executable boundary. It stores JSON Schema, idempotency mode, and supported invokers. V1 rules are:

- a bounded JSON Schema 2020-12 subset;
- `object` roots for input and output;
- `additionalProperties: false` by default;
- no remote `$ref`, arbitrary scripts, custom execution keywords, or uncontrolled formats;
- explicit limits for depth, node count, property count, string length, and serialized bytes;
- cross-validation of Schema, defaults, and Declaration in one publication transaction;
- canonical JSON plus a SHA-256 digest;
- immutable publication, with updates represented by a new Revision.

### 3.4 ModelResource and ModelResourceRevision

`ModelResource` is a stable logical identity such as `isnet.general`. A Revision is a reproducible model release containing:

- display name and purpose;
- format and runtime family, such as `onnx`, `tesseract-data`, or `wasm-bundle`;
- `browser | worker` targets;
- primary resource and bounded dependency manifest;
- byte size, SHA-256, media type, and resource role;
- source, license identifier, and source reference;
- controlled preprocessing profile and tensor contract;
- `draft | published | deprecated | revoked` lifecycle.

Model resources do not store Provider API keys or short-lived presigned URLs. Ordinary clients never receive S3 bucket names, object keys, or local filesystem paths.

### 3.5 CapabilityImplementationRevision

An Implementation continues to pin its Adapter, Execution Target, and Configuration. It may additionally pin a `ModelResourceRevision`.

Tensor details, normalization, and runtime ABI belong to the Implementation and model manifest, not the Capability Contract. Deterministic implementations need no model reference. Provider implementations reference governed model-service Route Policies rather than pretending remote models are ModelResources.

The first public release admits exactly three executable source kinds:

- `model_resource`, resolved to an immutable verified ModelResourceRevision;
- `model_service`, resolved to a governed RoutePolicyRevision;
- `plugin`, resolved to the immutable executable declared by a trusted Runtime Adapter.

Workflow, generic API, and MCP sources are not accepted as Implementation sources until
their own versioned registries, authorization checks, dependency resolvers, and runtime
executors exist. Their behavior can still be delivered through a trusted plugin Adapter;
the control plane does not publish source kinds that it cannot execute.

### 3.6 CapabilityBinding

A Binding owns only the ordered Workspace mapping from Contract to available Implementation:

- enable, pause, revoke, and priority;
- Provider Route Policy and parameter policy;
- Browser, Worker, and Provider candidate order;
- budget, health, permission, and data-egress decisions.

The Binding subresource does not own capability names, descriptions, Schemas, or model packages.

## 4. Object storage and model distribution

Model bytes reuse `StorageProfile -> StoredObject`. A StorageProfile may use the local filesystem or an S3-compatible adapter. A ModelResourceRevision references only sealed, digest-verified objects.

```text
Administrator upload or import
-> write through StoragePort and seal
-> validate size, SHA-256, and allowed media type
-> publish ModelResourceRevision
-> pin that Revision from ImplementationRevision
```

Browser download flow:

```text
GET Browser Runtime Manifest
-> reauthorize permission, Binding, Implementation, and Model Revision
-> return a same-origin, short-lived, Revision-bound resource URL
-> download and verify SHA-256 again
-> register Browser Executor with Implementation and Model digests
```

Worker acquisition flow:

```text
Deployment start or refresh
-> resolve an admitted Model Revision
-> pull through StoragePort into a controlled cache
-> verify size, SHA-256, and runtime ABI
-> report Deployment Admission
```

Constraints:

- private S3 resources never expose durable browser URLs;
- presigned URLs are neither persisted nor logged;
- published Revision bytes cannot be replaced in place;
- Browser and Worker compare immutable digests, not filenames;
- referenced resources can be Deprecated or Revoked but not physically deleted;
- garbage collection removes only unpublished or proven-unreferenced objects;
- the same-origin download endpoint controls ranges, cache headers, and cross-origin policy.

## 5. Input and output conventions

### 5.1 Two-layer contract

Every field has both:

1. a Contract Type for JSON serialization and runtime validation;
2. a Semantic Type for Workflow connections, Agent selection, and business editors.

Field names never infer Semantic Types. The persisted Declaration must state parameter and output semantics explicitly.

### 5.2 V1 parameter types

Capability packages and adapters declare fields through the governed publication
contract:

| UI type           | Contract type        | Common Semantic Type              |
| ----------------- | -------------------- | --------------------------------- |
| Text              | `string`             | `text.plain` / `prompt.rich`      |
| Number            | `number` / `integer` | `number.scalar`                   |
| Toggle            | `boolean`            | `boolean.flag`                    |
| Single file       | `string`             | `artifact.image` / `artifact.any` |
| File list         | `array<string>`      | `artifact.image_list`             |
| Structured object | `object`             | controlled Registry type          |
| Structured list   | `array<object>`      | controlled Registry type          |

Settings does not expose a free-form Contract editor. Package or adapter publication
passes through the same backend publication gate and cannot bypass validation.

### 5.3 Artifact outputs

Models and Adapters do not return Storage URLs. Artifact outputs use the existing `attempt-output-artifact/v1` reference and resolve to an Artifact ID during atomic Attempt completion. The Declaration also records Semantic Type, output role, and bundle.

### 5.4 Revision changes and post-release evolution

The first release distinguishes four changes instead of treating every edit as a
Contract upgrade:

| Change                     | Current behavior                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery metadata         | Publish another Declaration Revision against the same Contract. The current administration path changes localized title, description, category, and tags.   |
| Implementation replacement | Publish another Implementation Revision under the same Contract and explicitly replace or add its Binding. Existing execution-plan snapshots do not change. |
| Additive Contract change   | Adding an optional input or relaxing a safe bound is only a compatibility candidate. It is not automatically published or adopted.                          |
| Breaking Contract change   | Deleting a field, adding a required input, narrowing a type, or changing output semantics requires an explicit future evolution protocol.                   |

V1 stops before public Contract evolution. Definition creation publishes Contract
Revision 1. Later metadata updates publish Declaration Revisions, and run-method
updates publish Implementation Revisions for that same current Contract. There is no
Contract-update API, migration-plan table, compatibility-mapping artifact, Workflow
impact preview, dual-read runtime, discovery switch, or upgrade UI.

Published Workflow content pins the Contract key, Revision, and digest. A WorkflowRun
pins its Workflow Revision, and its ExecutionPlanSnapshot pins the exact Contract and
route candidates used for dispatch. Neither an additive classification nor a later
administration change rewrites those facts.

The trigger for designing the future evolution protocol is the first post-release need
to change an executable input or output Contract while a published Workflow, surface
entrypoint, Binding, or historical Run references the existing Revision. That work
must then define target-Contract review, compatibility mappings where meaningful,
affected-Workflow preview, new Workflow Revisions, ready run methods and surface
entrypoints, an atomic discovery switch, and cancellation before publication. These are
requirements for that future phase, not implemented V1 behavior.

## 6. Lifecycle actions

| User action                   | Domain action                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Install capability            | Publish a package or adapter that atomically creates its Definition, Contract, Declaration, and run methods |
| Edit discovery information    | Publish the next Declaration Revision while preserving the current Contract and run methods                 |
| Replace capability run method | Publish an Implementation Revision under the current Contract and explicitly update or add its Binding      |
| Change public Contract        | Not a V1 administration action; requires the future post-release evolution protocol                         |
| Delete unpublished draft      | Physically delete the unreferenced draft                                                                    |
| Remove published capability   | Archive the Definition and stop new discovery or Binding creation                                           |
| Restore capability            | Reactivate the Definition; a Revoked Revision remains revoked                                               |
| Add model                     | Create a ModelResource and publish or validate a Revision                                                   |
| Update model                  | Publish another ModelResourceRevision without replacing prior bytes                                         |
| Remove model                  | Delete only unpublished unreferenced data; otherwise Deprecate or Revoke                                    |

Every update carries an expected version. A concurrent change returns a recoverable 409 instead of last-write-wins behavior.

## 7. Agent and Workflow discovery

One published Declaration creates two projections.

### Workflow Catalog

- name, description, category, tags, and source;
- complete authoring-time parameter and output declaration;
- Contract Revision and available Binding state;
- only capabilities whose `supportedInvokers` includes `workflow` and whose Workspace route is authorized and available.

### Agent Capability Catalog

- stable, concise model-facing name and description;
- required inputs, primary outputs, cost/latency class, and side-effect summary;
- narrowed Agent-facing Schema;
- only the active policy intersection: invoker support, permission, Binding health, budget, data classification, and approval policy.

Discovery is not execution. A capability without an available canonical executor
appears in management with a recoverable status, but is excluded from Workflow and
Agent discovery. Agent execution still uses the WorkflowRun/CapabilityRun/Attempt
fact chain.

## 8. Administration pages

Settings contains two separate directories.

### Model resources

Table columns: name, format, execution location, current version, byte size, status, last update, and actions.

Import flow:

1. choose a Catalog recommendation, stable HTTPS URL, or local file;
2. let the Worker transfer, seal, hash, inspect, and identify the resource;
3. review only the detected name, format, license, compatible runtimes, and facts
   that could not be identified reliably;
4. publish the immutable resource and atomically enable dependent Catalog run methods.

Ordinary UI does not show bucket names, Storage keys, internal IDs, full digests, or runtime ABI. Permissioned diagnostics may expose those facts.

An automatically detected native model interface may be retained with the immutable
resource, but administrators never have to invent one. Capability field mapping uses
the selected Runtime Adapter's invocation interface; that is the callable boundary
the application can actually validate and execute.

A shared file format is only a probable runtime match. It may be shown during review,
but it does not certify an execution target or make the resource selectable by a
Capability. Only an exact Catalog/runtime admission does so; unknown model files
remain safely stored until a trusted adapter package declares and verifies support.

### Capabilities

Table columns: name, category, input-to-output summary, invokers, current run methods, version, status, and actions.

Capability creation uses a constrained field editor for public types, semantics,
enums, defaults, ranges, examples, invokers, and surfaces. The ordinary metadata
dialog edits only name, description, category, and tags. The run-method flow adds or
replaces a model resource, model service, or built-in/plugin Adapter with explicit
field mappings, fixtures, priority, and fallback.

The first-release page has no Contract-upgrade flow. A future flow must preserve the
boundary in section 5.4, but Settings currently creates an initial Contract, edits
discovery metadata, and manages run methods only under that current Contract.

Run-method management is part of the Capability detail flow. The backend still keeps Bindings as independently versioned runtime policy, but Settings exposes one Capability directory and one administration projection.

## 9. Defaults and fresh-install baseline

The project does not preserve development-era data before its first public release:

1. `0000_initial_schema.sql` contains the final control-plane Schema without development migrations or backfill SQL.
2. Default bootstrap registers one digest-pinned bilingual recommendation Catalog and
   the built-in Runtime Adapter registry rather than constructing installed Capability,
   Workflow, Skill, or model-resource facts in TypeScript.
3. Model recommendations are not pretend published resources. A dependent Binding,
   Workflow, or Skill stays disabled until real bytes are imported and verified.
4. Catalog, Agent, Browser Runtime, and Worker contain no old ToolView, VITE
   fixed-capability, model-path, or process-setting fallback.
5. A missing Declaration, Runtime Adapter, run method, model resource, or surface
   entrypoint fails closed and is repaired through Catalog installation or explicit
   configuration, never inferred from development-era data.

## 10. Security, audit, and recovery

- management APIs require `capability.configure`; model bytes and Storage configuration use narrower permissions where appropriate;
- list and detail APIs do not return Credentials, Secrets, raw Storage keys, or short-lived URLs;
- publication, archive, restore, Revision switch, and model import append audit events;
- Contract, Declaration, and Model Manifest use separate canonical digests;
- publication atomically updates Definition pointers to avoid half-published Contract/Declaration state;
- Bindings and execution plans reference immutable Revisions only;
- an active Run does not follow later administration changes;
- each new dispatch rechecks permission, revocation, budget, and health;
- a Revoked model or Implementation blocks new Attempts;
- Attempts with possible external side effects follow the existing unknown/manual recovery policy;
- import and publication use idempotency keys so retries return the same result.

## 11. Delivery phases and gates

### Phase 1: maintainable Capability directory

- persist Definition and Declaration Revisions;
- list, create, update, archive, and restore domain APIs;
- one Settings directory with safe metadata editing and nested run-method management;
- Workflow Catalog consumes persisted Declarations;
- Contract/Declaration cross-validation, concurrency, and immutability tests.

Gate: bootstrap a complete capability release, edit its discovery information without
changing its Contract or Bindings, archive it so it leaves discovery, and prove
Workflow and Agent discovery exclude capabilities without an available run method.

### Phase 2: ModelResource directory

- persist ModelResource, Revision, and StoredObject references;
- administration upload/import, S3-compatible storage, digest, and license validation;
- Settings table and dialog;
- ImplementationRevision explicitly pins ModelResourceRevision.

Gate: the same model resource passes publication, download, digest, and range checks on local and S3-compatible StorageProfiles.

### Phase 3: dynamic runtime admission

- Browser Runtime Manifest resolves active Binding, immutable ImplementationRevision, Runtime Adapter Revision, and optional immutable ModelResourceRevision;
- S3-backed models use a same-origin, reauthorized, digest-pinned stream endpoint;
- Web consumes the governed Manifest only and fails closed when the Manifest, model, or deployment is unavailable;
- Worker claims carry the same pinned identities, open bytes through StoragePort,
  verify SHA-256, and cache only by immutable Revision;
- revocation, fallback, parallel versions, and exact release selection remain governed
  by Binding and execution snapshots.

Gate: a new Run uses the new Revision, existing facts remain replayable, and bad digests, revoked models, and unavailable Storage fail closed with a recoverable route.

### Phase 4: Agent and Canvas consumers

- generate Agent Catalog and narrowed Schema from Declaration;
- expose `capability.search` and a reviewable `capability.invoke` only when a canonical
  Workflow entrypoint, permission, budget, and healthy Binding are available;
- derive Canvas tools from active Workflow/Skill entrypoints and apply results through
  undoable commands;
- keep model, Provider, Storage, Adapter, and Implementation identities out of both
  consumer documents.

Gate: Agent and Workflow see the same names and semantic ports; permission loss, insufficient budget, or unhealthy Binding narrows ToolView immediately; every Run exactly matches the ToolView digest generated by the new architecture.

## 12. Explicit V1 exclusions

- administrator-uploaded arbitrary Adapter code in production;
- Provider, Credential, or model URL stored directly on Capability;
- in-place mutation of a published Revision;
- physical deletion of a Revision referenced by a Workflow, Binding, Run, or Implementation;
- free-form expressions, remote JSON Schema `$ref`, or custom validation scripts;
- treating administration discovery as an executable Agent Tool;
- Marketplace, organization inheritance, or a cross-Workspace model repository.

## 13. First-release integration invariants

This implementation started from `codex/agent-mastra-integration` commit `134fd42` and was reconciled with the `open-source-readiness` worktree under these rules:

1. The first public release keeps one data-free `0000_initial_schema.sql`; development migrations, backfills, and temporary entry points are removed.
2. The baseline includes CapabilityDefinition, CapabilityDeclarationRevision, ModelResource, ModelResourceRevision, and Implementation-to-model mapping without old-data conversion statements.
3. Settings keeps formal Model Resources, Capabilities, and Workflow entry points. Capability run methods are managed inside the Capability page; the development-only `/skills` compatibility route is removed.
4. Agent Worker keeps the open-source query layout and appends capability projection after Query and Canvas projections without changing existing Tool keys, Workflow entrypoint order, or Canvas command semantics.
5. Default bootstrap registers one Catalog Package JSON and its built-in Runtime
   Adapters. Model recommendations become real ModelResourceRevisions, and Capability
   recommendations become installed Definitions and routes, only through the explicit
   user-confirmed installation paths. Runtime never infers them from legacy records.

Functional parity is provided by default declarations and end-to-end verification, not by a development-data compatibility layer.
