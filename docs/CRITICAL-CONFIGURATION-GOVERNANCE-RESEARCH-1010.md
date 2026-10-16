# Critical configuration governance research — 2026-10-10

## Conclusion and evidence boundary

Selected operational settings should be maintained through the administration UI.
Deployment must retain independent controls over network safety and credentials.
A generic environment-variable editor or an implicit union of deployment and UI
allowlists would obscure responsibility and weaken the existing boundary.

This research used local baseline `4a00b2c53a11e30026d66d5b088557e3351d8471` and
the official references below. It did not inspect production environment variables
or change production settings. Code defaults are not proof of deployed values.
The initial recommendations below precede the approved design; the
[implementation plan and runbook](plans/runtime-configuration-governance-implementation.md)
record the final decisions and delivered behavior.

## Baseline findings

1. Result origins originally came from `KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS`,
   parsed at Worker startup and passed to the shared transport. An explicit list
   restricts exact origins; omission adds no origin restriction. HTTPS, address
   checks, DNS pinning, redirect rejection, deadlines and size limits remain
   independent. `KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED=false` blocks downloads.
   Saving a Provider did not update the running result allowlist. See
   [configuration](../apps/worker/src/config.ts),
   [transport construction](../apps/worker/src/main.ts),
   [transport enforcement](../apps/worker/src/provider/provider-http-transport.ts)
   and the [configuration contract](CONFIGURATION.md#worker-variables).
2. Other critical settings already have administration interfaces. Provider
   endpoints, credentials and models are persisted; instance, Workspace and route
   policy revisions are intersected with optional deployment hard bounds. Those
   policies cover adapters, geography, endpoints, routing, price and request
   timeout, but did not govern result origins. See the
   [Provider controller](../apps/server/src/http/workspace-provider-settings.controller.ts),
   [policy types](../packages/database/src/runtime/configuration-policy.ts),
   [route policy](../packages/database/src/runtime/provider-route-store.ts) and
   [Provider activation](../packages/database/src/runtime/provider-settings-store.ts).
3. Agent limits follow a separate chain. The baseline default profile revision 11
   specifies 16 model calls, 24 tool calls and 600 seconds. A Run persists its own
   budget; effective steps are `min(maximumModelCalls, maximumToolCalls + 1)`.
   Raising only the model limit to 50 leaves a 25-step ceiling when tools remain 24.
   See the [default profile](../packages/application/src/modules/agent/application/default-agent-profile.ts),
   [step calculation](../packages/agent-runtime/src/surface-agent.ts),
   [Run store](../packages/database/src/runtime/agent-runtime-store.ts) and
   [manifest validation](../packages/application/src/modules/agent/application/agent-foundation.ts).
   The model-call contract allows 1–64; historical recollections of 50 require
   deployment evidence rather than inference from local code.

## Ownership recommendations

| Setting                                                        | Recommended owner                                          | Effective behavior                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Result origins                                                 | Instance administrators, with service-specific rules       | Explicit deployment delegation; otherwise deployment remains authoritative                         |
| Download switch                                                | Deployment emergency switch plus administrator pause       | Both must allow; instance pause affects every service                                              |
| Provider API endpoint                                          | Existing Provider administration                           | Validate against API-origin deployment constraints; keep result origins separate                   |
| HTTP, private networks, proxy and TLS                          | Deployment                                                 | No ordinary UI expansion of the network trust boundary                                             |
| Agent model/tool limits and timeout                            | Instance runtime governance after approved scope expansion | New runs snapshot the policy; existing runs retain their budget                                    |
| Models, budgets, prices and request timeouts                   | Existing domain administration                             | Preserve established restrictive bounds and budget enforcement                                     |
| Worker concurrency, leases, heartbeats and pools               | Deployment                                                 | Capacity and process consistency require coordinated rollout                                       |
| Database, Redis, storage identity, authentication keys and KEK | Deployment and secret management                           | No plaintext export or generic hot-edit interface; retain dedicated Provider credential management |

## Policy semantics and approved refinements

The initial research proposed intersecting deployment, backend and optional
Workspace origin restrictions. The user subsequently approved explicit delegation
of daily origin management to the backend, instead of requiring an environment
change for every new CDN. The implemented mode is therefore:

```text
Environment mode: deployment origin policy is authoritative.
Instance mode: latest activated database policy is authoritative for origins.
Downloads allowed: deployment emergency switch AND instance switch AND service switch.
Service rule: explicit Workspace/endpoint override, otherwise instance default.
```

An omitted service override inherits. A null origin list imposes no additional
origin restriction; an explicit empty list denies all origins. These states must
be distinct in the UI. Existing blank environment strings retain their legacy
meaning. Backend entries accept HTTPS origins without paths, queries, credentials
or wildcards. An upstream response never automatically adds a new allowed origin.
Address validation, redirect rejection, size bounds and deadlines remain active.

Only instance administrators may publish these policies. Workspace administrators
cannot expand instance network authority through this feature. The initial
research deferred Agent limits; subsequent approval included unified 50 model
calls, 100 tool calls and 600 seconds in the same governed document.

[OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
distinguishes known trusted destinations from arbitrary external targets and
emphasizes DNS and redirect bypasses. Moving configuration to a database does not
remove these checks. The Kanvas ownership model is a design inference from those
principles, not an OWASP-prescribed architecture.

## Authorization, activation and recovery

Reuse the [instance administrator guard](../apps/server/src/http/instance-administrator.guard.ts).
Revalidate authority in the transaction, require an expected version and reason,
and append an immutable revision and audit event atomically. Keep full signed
result URLs and secrets out of ordinary audit text. Show effective source and
Worker observations instead of treating a database save as proof of activation.

Read the active policy at each download boundary and retain that snapshot through
transfer retries. Do not interrupt an already-issued transfer when policy changes.
A read failure must not fall back to an unrestricted policy. Process-level
configuration changes still require rolling replacement and observation.
[Kubernetes documents that environment-based ConfigMap values do not update
running processes](https://kubernetes.io/docs/tutorials/configuration/updating-configuration-via-a-configmap/).
Changing a Matrix value alone does not prove every Worker uses it.

Model and tool budgets are fixed at Run admission, while the next result download
uses current network policy. Persist upstream evidence independently of local
allowlist decisions, including successful tasks. After an authorized policy
correction, the task owner can explicitly fetch saved results with GET only.
Keep a separate recovery record and the original failure. An expired URL must be
reported as expired, rather than silently replaced with another generation POST.
Retained signed URLs require bounded storage and must not enter ordinary logs.

Rollback republishes old content as a new revision. Deployment emergency controls
still apply, and activated governance cannot be rolled back into an implicit
legacy mode. Manual publication, observation and rollback fit the present scope;
a separate configuration platform is unnecessary. Validation, staged deployment,
monitoring and recovery in [AWS AppConfig](https://docs.aws.amazon.com/appconfig/)
and its [rollback documentation](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-deploying-reverting.html)
provide reference patterns without implying an AWS dependency.

## Implementation sequence

1. Preserve original upstream evidence before download filtering. No policy UI can
   reconstruct a URL discarded by historical executions.
2. Expose effective limits, origins, switches, policy revision and Worker observation
   time so saved settings can be compared with execution facts.
3. Add versioned administrator publication, concurrency control, audit and rollback,
   initially supporting instance defaults and scoped service overrides.
4. Pass trusted policy context into transport; retain all existing network safety
   checks. Test empty and inherited lists, emergency denial, cross-scope authority,
   concurrent publication, unreadable policy and rollback.
5. Add explicit recovery based on retained evidence, and prove that it only issues
   GET requests and preserves the original task outcome.

The approved implementation also includes Agent admission governance. Infrastructure
capacity, credentials and generic environment editing remain outside this scope.
See the [final runbook](plans/runtime-configuration-governance-implementation.md#deployment-and-activation-runbook)
for migration and activation order.
