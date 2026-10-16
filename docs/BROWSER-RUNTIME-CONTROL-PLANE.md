# Browser runtime control plane

Browser is a governed Capability execution target, not a trusted Worker. It receives
short-lived execution authority while MySQL remains authoritative for Session,
Assignment, Attempt, Artifact, and Usage facts.

## Trust boundary

- Do not trust user agent, client clock, cache claims, or completion state.
- Registered runtime releases, model digests, capabilities, and device facts are
  bounded.
- Browser claims only an Attempt authorized for its current Session, Workspace, and
  execution generation.
- A grant cannot be reused across Session, Attempt, Implementation, or output role.
- Output passes Storage seal, media verification, and atomic completion.

## Durable facts

BrowserExecutorSession stores:

- Workspace, Principal, and Session identity;
- runtime release ID and digest;
- creation, expiry, revocation, and last heartbeat;
- registered capability digest and version.

BrowserExecutorCapability stores:

- Capability Contract and Implementation Revision;
- model or runtime asset digest;
- input limits, execution abilities, and quality profile;
- current availability.

BrowserAttemptAssignment stores:

- Workflow, Node, CapabilityRun, and Attempt;
- Session and Implementation;
- execution generation, lease, and deadline;
- input Artifact and expected output role;
- grant state and cancellation facts.

## Registration and claim

Web registers the current release and capabilities from an authenticated Session.
Server revalidates:

- Workspace authority;
- release ID, digest, and deployment allowlist;
- current Capability and Implementation lifecycle;
- whether instance policy enables Browser execution;
- model-asset declaration and input limits.

Claim uses bounded long-poll HTTP and returns at most one Assignment. A conditional
database update prevents two tabs or Sessions from claiming the same Attempt.

## Attempt grant

A grant is short-lived, signed authority bound to:

- Session, Workspace, Attempt, and lease generation;
- Implementation Revision and execution target;
- input Artifact, output role, and maximum byte count;
- issued time, expiry, and execution generation.

It contains no storage credential, provider secret, or arbitrary object key.

## Heartbeat and cancellation

- A lease-renewing heartbeat carries the current lease-token hash and generation.
- Server responds with `continue`, `cancel_requested`, or `rejected`.
- Logout, Workspace revocation, release revocation, and instance fencing prevent
  renewal.
- A cancellation request is not final cancellation. Browser stops and confirms;
  Reconciler handles timeout.
- Refresh or disconnection does not automatically create a new Attempt.

## Input and output

Every input Artifact is reauthorized and delivered as a bounded stream or Blob. An
internal storage URL does not grant long-lived access.

Output flow:

1. Use the UploadSession assigned to the Assignment.
2. Write and seal the object.
3. Server validates media, size, and SHA-256.
4. Browser submits Completion Manifest v1.
5. Atomic completion revalidates lease, generation, deadline, and output identity.

A late, duplicate, or revoked completion does not create a committed Artifact; its
orphan object becomes garbage-collection input.

## Fallback

A Browser failure provides only an Attempt failure fact. Pinned route policy and
Attempt transition policy decide whether to advance to a Worker or Provider candidate.

Automatic fallback is prohibited when:

- side effect is unknown;
- output is sealed but completion state is unknown;
- the route does not declare the corresponding reason;
- budget or deadline no longer permits it;
- candidate identity differs from the Run snapshot.

## Current browser capabilities

Vite build-time flags explicitly enable browser capabilities, including background
processing, subject detection, image adjustment, and batch composition. Enabling one
requires pinned runtime and model releases, digests, and probe facts. A disabled
capability downloads no assets and registers no execution ability. OCR uses the Worker
control plane and an imported Model Resource instead of a browser build flag.

See [CONFIGURATION.md](CONFIGURATION.md) for public variables and conditional fields.

## Verification

- Registration, claim, heartbeat, cancel, and complete contract tests.
- Concurrent multi-tab claims, lease loss, and generation fencing.
- Runtime release or model digest mismatch.
- Lost output responses, duplicate completion, and orphan garbage collection.
- A representative real-browser flow for every enabled capability.
