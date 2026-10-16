# Configuration, secrets, and providers

See [CONFIGURATION.md](CONFIGURATION.md) for each environment variable's component,
requirement, and default. This document records only the domain boundaries for runtime
configuration, secrets, and providers.

## Configuration layers

Kanvas separates four kinds of fact:

1. **Deployment configuration**: hosts, ports, file paths, adapter allowlists, and
   immutable security ceilings read at process startup.
2. **Instance or Workspace Policy Revision**: versioned business policy published by
   an administrator.
3. **Provider Setting and Binding**: provider, model, credential identity, and
   capability route currently enabled for a Workspace.
4. **Run Snapshot**: model, pricing, route, SecretVersion identity, and budget pinned
   for one Run.

These layers do not use generic last-write-wins resolution. Database policy cannot
raise a deployment security ceiling; Workspace policy may only narrow what instance
and deployment allow.

Schema-validated JSON environment variables or mounted files carry nested monetary
limits, allowlists, and provider hard bounds. Simple ports, switches, and durations
remain scalar.

## Secret facts

Credential expresses business identity and purpose. SecretVersion expresses one
immutable material version. Ordinary business tables, Run snapshots, Audit, logs, and
APIs store only SecretVersion ID, generation, and fingerprint.

Supported material sources are:

| Source                 | Use                                                            |
| ---------------------- | -------------------------------------------------------------- |
| `deployment_reference` | Stable reference resolved to a secret file by mounted JSON map |
| `encrypted_database`   | DEK wrapped by versioned KEK; material encrypted with AES-GCM  |
| `plaintext_database`   | Explicit self-hosted mode; database backup contains plaintext  |

Production should use `deployment_reference` or `encrypted_database`. Encrypted
database writes require `KANVAS_PROVIDER_KEK_MAP_FILE` and
`KANVAS_PROVIDER_ACTIVE_KEK_VERSION`. Plaintext mode never presents itself as
encrypted; administration and operations surfaces must state its risk.

Material exists briefly inside a governed resolver immediately before use:

```text
Pinned SecretVersion
  -> validate lifecycle and generation
  -> resolve deployment file or decrypt database material
  -> invoke Adapter
  -> zero temporary buffer
```

SecretVersion lifecycle is `active`, `draining`, `revoked`, or `destroyed`:

- Normal rotation creates a new Version and leaves the old one draining until the
  absolute dispatch deadline.
- Security revocation immediately prevents new claims and calls.
- `destroyed` removes every material field while retaining identity and audit facts.
- A Run snapshot pins its Version; runtime never silently uses the latest secret.

## Provider model

The following concepts remain separate:

- **Provider Setting**: Workspace provider-configuration aggregate.
- **Adapter**: protocol implementation governed by code.
- **Endpoint**: pinned origin, region, and network policy.
- **Provider Model**: provider-specific model identity and capability facts.
- **Canonical Model**: logical identity across providers.
- **Model Catalog Snapshot**: one discovery result.
- **Model Profile or Binding**: Workspace choice and purpose.
- **Pricing Revision**: auditable pricing rule.
- **Route Policy Revision**: ordered candidates and fallback.

Provider names and model catalogs do not enter Capability contracts. A Capability
describes business semantics; its Implementation and Binding choose adapter and model.

## Adapters and HTTP

- Adapter key must appear in Worker's deployment allowlist.
- Origin exactly matches the pinned HTTPS origin in the setting.
- HTTP, private addresses, redirects, result downloads, and explicit CONNECT proxies
  are governed independently.
- Ambient `HTTP_PROXY` and `HTTPS_PROXY` are not inherited by providers.
- Request and response size, redirect count, and download size have hard limits.
- A secret enters only authorization or header construction, never logs or persistent
  request snapshots.
- Raw provider errors become bounded diagnostics and stable business errors.

Current code has governed adapters for OpenAI Native, OpenAI-compatible, OpenRouter,
Anthropic, Google, DeepSeek, xAI, and Generation Tasks. Deployment allowlist and
Workspace settings determine actual availability.

## Model catalog and pricing

Remote discovery first creates a staging snapshot. It becomes the current catalog only
after administrator review. Discovery never automatically:

- activates a model;
- changes the default Agent model;
- creates a Capability Binding;
- changes pricing;
- expands budget or regional policy.

A Pricing Revision pins currency, metering units, tiers or fixed charges, and evidence
source. Provider-reported Usage is an input fact and becomes Canonical Usage only
through the current pricing and settlement protocol.

## Route, retry, and budget

ExecutionPlanSnapshot pins an ordered route candidate with:

- Contract, Binding, and Implementation identity;
- execution target, adapter, and model;
- parameter policy and Credential Version;
- maximum charge, region, and data egress;
- retry and fallback reasons.

A retry remains on the current candidate. Fallback advances only when the snapshot
allows the reason, no side effect is unknown, and budget still permits it.

Budget Reservation is created before invocation; terminal settlement uses trusted
Usage and Pricing. Timeout or crash does not imply zero cost. Reconciler observes the
provider or moves the fact into manual handling.

## Administration and audit

- Secret material appears once in the request that creates or rotates it.
- Later APIs return only a redacted identifier, fingerprint, generation, and lifecycle.
- Activation, deactivation, model adoption, pricing changes, rotation, revocation, and
  deletion write Audit.
- A Provider Setting cannot be deleted while an active Binding, Run, or unrecoverable
  budget fact depends on it.

Implementation locations:

- `packages/secrets`: material writes, resolution, and KEK or file maps;
- `packages/database`: Provider Setting, Catalog, Route, SecretVersion, and Budget
  stores;
- `apps/server`: administration API and authority;
- `apps/worker`: adapters, network transport, Usage, and Settlement.

See [PROVIDER-RUNTIME.md](PROVIDER-RUNTIME.md) for provider execution.
