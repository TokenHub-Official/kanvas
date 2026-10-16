# Provider runtime

Provider Runtime executes only a candidate already pinned by the control plane. It
does not choose a business capability, read the latest model or secret, or own final
budget and Artifact facts.

## Invocation chain

```text
CapabilityAttempt
  -> Provider Execution Context
  -> Pinned Route Candidate
  -> Resolve SecretVersion
  -> Adapter Request
  -> Provider Observation
  -> Usage and Artifact materialization
  -> Atomic Attempt completion
```

Claim revalidates Workspace, Attempt, Implementation, Route, Model, Secret Generation,
execution generation, and deadline. Any mismatch rejects the invocation.

## Adapter boundary

An adapter receives a normalized context containing:

- pinned endpoint and provider model;
- validated parameter policy and input Artifacts;
- short-lived secret material;
- request key, deadline, and maximum request and response sizes;
- network, region, result-download, and data-egress restrictions.

It returns:

- provider request or task identity;
- bounded state and diagnostics;
- provider-reported usage;
- structured text or media ready for materialization;
- evidence of whether a side effect occurred.

An adapter does not write Workflow, Usage Ledger, Artifact, or Budget tables.

## Protocol continuity

Provider reasoning context cannot be pruned by one generic rule:

- OpenAI Responses retains corresponding reasoning items;
- DeepSeek Chat retains `reasoning_content`;
- Gemini retains `thoughtSignature`;
- Anthropic retains its native tool and thinking turn structure.

Kanvas can compact business history but cannot break provider-required tool-turn
pairs or signed context.

## HTTP and network

- Only deployment-enabled adapters and Workspace-pinned origins are allowed.
- HTTPS is required by default; private, loopback, link-local, and unexpected redirect
  targets are rejected.
- Explicit proxies, HTTP, private networks, and result downloads each require separate
  configuration.
- Request, response, download, redirect, and observation counts have hard limits.
- Headers, cookies, secrets, prompts, and raw provider payloads are not logged.
- A remote result URL is not an Artifact. A governed downloader, media verification,
  and Storage commit must materialize it.

## Asynchronous providers

An asynchronous task first persists provider task identity, then advances through
observations:

```text
dispatching -> submitted -> observing -> terminal
```

After a process crash, Reconciler resumes polling from database facts. A callback is a
hint and cannot bypass polling, identity validation, or an idempotent terminal
transaction.

Timeout categories are:

- **Before invocation**: no side effect occurred; apply the snapshot policy.
- **Submitted but unknown**: record an unknown effect and do not retry automatically.
- **Known terminal but not committed locally**: rematerialize and complete
  idempotently.

## Usage and settlement

A Budget Reservation and Maximum Charge exist before invocation. Provider-reported
tokens, images, duration, or fixed charges are stored as source facts, then a Pricing
Revision converts them to Canonical Usage.

- `provider_reported` does not mean invoice-verified.
- Unknown effect does not release all cost as zero.
- One Attempt has at most one terminal Settlement.
- Agent model usage and Capability provider usage settle separately.
- Replaying an observation or completion does not duplicate Ledger records.

## Artifacts

URL-based image protocols persist upstream result evidence before attempting
materialization, for both successful and failed deliveries. The immutable
`provider_invocation_observation.result_facts.resultEvidence` contains original
HTTP(S) URL text and counts; it is independent of the deployment download allowlist.
Evidence preserves URL order and signing parameters. At most 16 addresses of 8192
characters each are retained. Malformed addresses, embedded credentials, unsupported
schemes and excess entries contribute to `omittedCount` instead of disappearing
silently. Inline base64 output is not duplicated into URL evidence.

Evidence is private and is never a download authorization. Existing `resultUrls`
contains only policy-approved fallback links; the normal Capability Run response
never exposes `resultEvidence`. Audit timelines show only origin/count metadata,
without signed paths or query parameters. Historical records without raw evidence
remain readable, but previously discarded addresses cannot be reconstructed locally.
A future recovery GET must revalidate the current network policy; preserving an old
URL must never bypass origin, DNS, redirect, size or timeout checks.

Provider media output passes through:

1. Validate result origin, media type, and size.
2. Write through a Server- or Worker-owned Upload to a random object key.
3. Seal and verify SHA-256, dimensions, frame count, and decode budget.
4. Atomically create StoredObject, Artifact, AttemptOutput, Usage, and Outbox.

A provider URL, task ID, or filename is provenance metadata, never persistent object
identity.

## Runtime roles

Worker's `provider-execution` role invokes and observes providers. `reconciler`
repairs leases, unknown effects, and incomplete settlement. `maintenance` handles
orphan objects and expired facts. Roles may run in separate processes but share MySQL
authority and the generation fence.

See [CONFIG-SECRETS-PROVIDERS.md](CONFIG-SECRETS-PROVIDERS.md) for configuration and
secrets and [CONFIGURATION.md](CONFIGURATION.md) for environment variables.
