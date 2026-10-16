# APIs and contracts

This document defines the current authority, generation pipeline, and HTTP conventions
for cross-process contracts. It does not record implementation batches or one-off
verification results.

## Authority

- TypeBox schemas in `packages/contracts` are the source authority for HTTP,
  Workflow, Capability, Editor, and event envelopes.
- OpenAPI, JSON Schema, and Web types are generated from the same schemas and
  committed.
- Application and Database may import contract types; Contracts does not import Apps,
  Database, or runtime packages.
- Third-party libraries may use Zod internally, but it is not a Kanvas cross-boundary
  schema authority.
- Database constraints enforce persistence invariants and cannot be replaced by HTTP
  schemas.

Current important versions:

| Contract                    | Version                       |
| --------------------------- | ----------------------------- |
| Workflow Topology           | `kanvas.workflow-topology.v1` |
| Editor Document             | `kanvas.editor-document/v1`   |
| Attempt Completion Manifest | `1`                           |
| Workflow Execution Plan     | `1`                           |
| Provider Route Snapshot     | `1`                           |

The first public release does not accept development-era versions of these contracts.
[ADR-0035](decisions/0035-retire-project-deliverable-and-converge-internal-formats.md)
records the internal V1 baseline and separates format versions from content Revisions,
execution fences, and third-party protocol identities.

## Schema design

- Objects default to `additionalProperties: false`.
- String length, array length, object property count, and recursive depth are bounded.
- ULIDs, SHA-256 values, datetimes, currency, and pagination cursors use shared
  primitives.
- Wire contracts do not contain Date, BigInt, Buffer, Map, Set, class instances, or
  database types.
- Wire monetary values are fixed-point decimal strings; Database uses DECIMAL;
  business code never uses floating-point money.
- Large integer measurements are canonical decimal strings to avoid JavaScript safe
  integer loss.
- Secrets, cookies, internal route scores, database field names, and raw provider
  payloads do not appear in ordinary responses.

Canonical digests are calculated from canonical business documents. JSON serialization
order, database JSON key order, and log presentation are never treated as business
digests.

## Route contracts

Every HTTP route declares:

- a stable route ID, method, and path;
- path, query, header, body, and response schemas;
- identity and Workspace authority;
- idempotency requirements;
- possible problem codes;
- whether it creates an asynchronous Run.

A controller parses transport input, establishes trusted context, and calls an
Application use case. It does not construct database queries, resolve secrets, or
invoke providers directly.

## HTTP semantics

| Behavior                                   | Convention                                      |
| ------------------------------------------ | ----------------------------------------------- |
| Create a resource                          | 201; an idempotent replay returns the same fact |
| Synchronous read or update                 | 200                                             |
| Accept asynchronous execution              | 202 with a queryable Run identity               |
| Successful response without a body         | 204                                             |
| Invalid shape or field                     | 400                                             |
| Unauthenticated                            | 401                                             |
| Unauthorized or outside the Workspace      | 403                                             |
| Missing or invisible                       | 404                                             |
| Optimistic, idempotency, or state conflict | 409                                             |
| Request body too large                     | 413                                             |
| Rate or budget limit                       | 429                                             |
| Service temporarily unavailable            | 503                                             |

A long-lived HTTP request does not represent completion of asynchronous work. Clients
read WorkflowRun, AgentRun, or another durable fact and update the UI through bounded
polling or a governed stream.

Cancellation is a separate command. Accepting it moves the request toward
`cancelling`; runtime facts determine the final `cancelled`, `completed`, or `failed`
state.

## Problem details

Error responses contain a stable business code, actionable recovery information, and
an optional request ID. They do not contain:

- stacks, SQL, provider credentials, or headers;
- internal table names, primary keys, route scores, or retry orchestration;
- unredacted user content or raw provider responses.

Retryability is expressed by the stable code and current state, never inferred from
English message text.

## Idempotency and concurrency

- Create and command operations with durable side effects require an explicit
  idempotency key.
- The key is bound to a canonical request digest; the same key with a different
  request returns 409.
- A successful replay returns the original business identity and does not write a
  second Audit, Outbox, Usage, or Artifact record.
- Draft, Binding, and control-plane updates use `expectedVersion` optimistic
  concurrency.
- Provider requests, uploads, and Attempt completion also use domain request keys,
  leases, and generation fences; an HTTP header alone is insufficient.

## Pagination and queries

- Collection queries use stable ordering and a bounded limit.
- A cursor is an opaque wire value whose version, scope, and sort fields are validated
  by Server.
- List responses do not implicitly load large documents, prompts, Artifact content,
  or provider payloads.
- Time range, state, and Workspace are constrained in database queries.

## Agent and provider projections

An Agent-facing tool schema is a governed projection of a Capability contract. It may
narrow fields, enum values, budgets, and data egress, but it cannot expand authority.

A provider request schema is an internal adapter contract. It may contain
provider-protocol fields, but it does not leak into user APIs or replace Kanvas
Capability, Usage, or Artifact facts.

## Generation pipeline

```text
packages/contracts source
  -> TypeScript build
  -> OpenAPI and JSON Schema
  -> Web openapi-typescript types
  -> committed generated files
```

Common commands:

```bash
pnpm generate:contracts
pnpm generate:check
pnpm docs:check
```

CI regenerates and compares output from a clean checkout. A source-schema change must
commit its generated output; manual edits to generated directories are overwritten.

## Change rules

- Prefer optional new fields and document their absent semantics.
- Removing or renaming a field, tightening a constraint, or changing state semantics
  requires coordinated updates to consumers, generated output, database constraints,
  and tests.
- Before the first public release, update development-era contracts directly to the
  current version; do not retain unused compatibility parsers.
- After a public release, a new ADR and explicit support window must define
  compatibility policy. Do not guess it silently in implementation code.
