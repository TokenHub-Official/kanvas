# Deployment configuration convergence

Status: implemented locally, 2026-09-20; release validation in progress. No
production configuration has been changed. This extends Agent discovery/execution
recovery. Increment sections below record intermediate states; the final contract
is documented in `docs/CONFIGURATION.md`.

## Problem and evidence

Previous governance established component ownership, documented defaults and safe
environment-file setup. Those improvements are useful, but do not guarantee that
a minimal installation can complete a user task.

- `tools/code-health/check-env-contract.mjs` checks variable-name documentation
  coverage, not default behavior or conditional requirements.
- `docs/CONFIGURATION.md` calls deployment hard bounds optional; the current
  Provider capability readiness path can reject a configured capability when
  they are absent. The Worker parser accepts absence.
- Provider execution also depends on roles, execution targets, adapter keys and
  network settings outside the persisted Provider configuration.
- The official single-image template enables Provider execution but omits the
  hard-bounds input. Fixing that omission alone perpetuates duplicate ownership.

The earlier patch describing hard bounds as required is a tactical diagnosis of
current behavior, not the desired permanent installation contract.

## Target ownership

The following is a family-level decision inventory, not a claim that every
individual variable's runtime behavior has already been verified.

| Configuration family                                           | Decision                                            | Requirement / default                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connection                                            | Keep deployment input                               | Required for a database-backed service; URL or split fields, never both; port defaults to 3306                                                          |
| Redis connection                                               | Keep deployment input                               | Required for processes using the queue; URL or split fields; port 6379 and database 0                                                                   |
| Public URL                                                     | Keep deployment input                               | Required in production; derive same-origin URLs from it unless explicitly overridden                                                                    |
| Authentication secret                                          | Keep durable deployment secret                      | Required secret source; installation may generate it once and persist it, never regenerate on restart                                                   |
| Instance and storage profile identities                        | Installation-owned                                  | Official instance/local profile defaults retain previous template identities; explicit identities win; no per-start random defaults                     |
| Storage backend and credentials                                | Conditional deployment input                        | Official local-volume installation supplies its known internal path; external storage requires its actual endpoint, bucket and credential source        |
| SMTP / OIDC                                                    | Optional integration inputs                         | Require related fields only when selected; preserve TLS and secret validation; keep login infrastructure deployment-owned                               |
| Image versions / release digests / browser bundle identity     | Release-owned                                       | Ship verified metadata with the release; operators select releases rather than inventing identifiers                                                    |
| Worker roles / execution targets                               | Packaging-owned default                             | Official all-in-one profile wires supported installed roles; split deployments retain explicit role overrides and readiness checks                      |
| Provider adapter keys                                          | Installed-code registry                             | Resolve supported adapters from validated Provider configuration; retain explicit operator restrictions where needed                                    |
| Provider endpoint origins                                      | Persisted Provider configuration plus network guard | Validate authorized endpoint configuration; do not require duplicate manual environment entries for normal setup                                        |
| Provider result-download origins                               | Validated result-delivery policy                    | Do not trust arbitrary tool-returned URLs or infer all CDNs from the API origin; preserve DNS, redirect, TLS and private-network protections            |
| Deployment hard bounds                                         | Optional operator overlay                           | Absence adds no deployment restriction; configured restrictions intersect with instance/workspace/route policies; invalid supplied policy fails clearly |
| Provider KEK / deployment secret map                           | Conditional secret-storage option                   | Preserve existing encrypted records and key references; never regenerate keys to repair missing configuration                                           |
| Lease / timeout / concurrency / polling / byte limits          | Advanced optional overrides                         | Keep coordinated, validated defaults; omit from the minimal installation template                                                                       |
| Logging / telemetry / proxy settings                           | Optional operations inputs                          | Useful defaults; trust-proxy count remains topology-specific and is not guessed                                                                         |
| Demo / development adapters / bootstrap / canary / test inputs | Separate command or development profiles            | Exclude from the ordinary production setup; never enable development adapters implicitly                                                                |

Do not consolidate these into one opaque configuration JSON. Fewer operator
decisions, rather than fewer variable names, is the objective.

## Implementation sequence

1. Inventory actual configuration consumers. For each variable record owner,
   deployment profile, default, required-when condition, secret source,
   mutability and replacement. Separate runtime inputs from release and test
   inputs. Mark inferred documentation separately from verified parser behavior.
2. Correct Provider policy semantics at the shared resolver, not only discovery.
   Test absent, malformed and restrictive overlays across management readiness,
   Agent discovery and execution. Authorization, budgets and network controls
   remain mandatory. Do not represent absent policy as an unrestricted policy
   object that could override lower-level limits.
3. Make supported packaging supply role wiring, release metadata and known
   storage wiring. Keep stable installation data durable and shared by Server
   and Worker. Support restart, multiple replicas and existing installations.
4. Remove duplicate Provider setup through a common validated resolution path.
   Endpoint configuration changes require the existing administrative authority;
   result-download authorization needs its own explicit policy.
5. Produce minimal installation examples and separate advanced overrides from a
   checked configuration contract. Reuse component validators; avoid adding a
   second independent parser or undocumented precedence layer.
6. Validate cross-component dependencies before enabling a feature. Report the
   missing dependency and its responsible administrator; do not silently return
   an empty capability catalog. Configuration errors must remain distinct from
   unavailable external services.

## Compatibility and acceptance

- Preserve explicit existing deployment restrictions. Absence and an explicitly
  empty allowlist must not be interpreted as equivalent.
- Preserve existing secrets, encrypted credentials, installation identities and
  storage references. Preview migrations without printing secret values.
- Check default omission and explicit override paths. Reject contradictory
  alternatives and malformed supplied values with actionable errors.
- From the minimal supported installation, create the first administrator,
  configure a Provider/model in the backend, discover and invoke an image
  capability, then view and download its result. A successful health check or
  documented variable list is insufficient acceptance evidence.
- Repeat after restart and upgrade; test the supported split deployment profile.
- Verify explicit operator restrictions still deny prohibited endpoints and
  spending, and SSRF/redirect/private-address checks remain effective.
- Keep external Provider E2E evidence separate from fixtures and local tests.
  A live production rollout remains a separate operational step.

Agent empty-catalog retry suppression is only a latency safeguard. It cannot
replace capability readiness, configuration resolution or installation tests.

## First implementation increment

The shared route resolver now supports an absent deployment overlay by evaluating
only the exact persisted candidate against instance, Workspace and route policies.
Direct capability invocation, Workflow execution, effective schema projection and
preflight no longer reject solely because that optional overlay is absent.
Explicit malformed overlays still fail parsing; explicit restrictive overlays
still deny candidates. No deployment configuration or live Provider was changed.

Validation: database package and dependencies build; focused projection/control-
plane tests; disposable MySQL route and capability/preflight integration tests.
The MySQL fixture verifies equal route snapshots with and without an optional
operator overlay and rejection under an explicit prohibited-region overlay.
This does not establish live external image generation or complete the remaining
packaging/defaults/inventory work above.

## Second implementation increment

The official standalone image now applies role/target defaults after decoding
transported configuration. Direct and encoded explicit overrides win. Worker
configuration uses its installed HTTP adapter registry when Provider execution
is enabled and the adapter list is omitted; explicit lists remain restrictions.
The minimal deployment example no longer asks operators to repeat those lists
or unchanged port, migration-mode and result-download defaults.

Validation includes loading the real image preload through the Worker parser,
explicit override/empty-list behavior, transport decoding and entrypoint checks.
This is not a built-container or live Provider E2E result. API origin restrictions,
result-download controls and stable storage identities remain explicit; their
convergence requires separate persisted-configuration and upgrade validation.

## Third implementation increment

API origins now have one ordinary configuration source: the Provider endpoint
validated by `provider-execution-context-store`. Every built-in Provider API call
uses `request.executionContext.endpoint.baseUrl`; remote outputs select the separate
`provider_result` transport target. The optional environment origin list adds an
operator restriction. Explicit empty lists fail closed. Transport tests retain
DNS/address, protocol, header, redirect, payload-size and streaming deadline checks;
result-download checks run with no API overlay to prove the two policies remain
independent. The explicitly configured CONNECT proxy remains its existing separate
DNS/network trust boundary.

No live Provider call or production mutation has been made. Storage identity
creation/backfill still needs a separate upgrade-safe implementation; existing
profile IDs and roots remain unchanged.

## Final convergence and compatibility contract

The complete image supplies production/instance/role/target defaults and the
previous official local storage identity/root only when no storage configuration
is supplied. Custom local, S3 and OSS configurations opt out of the entire local
default group. Stable shipped identities replace the earlier proposal to randomly
generate installation identities: they preserve the existing standard template
and avoid new mutable installation metadata, startup races or identity rotation.
Explicit configuration values and existing persisted records remain authoritative.

Provider result downloads default to enabled with existing protocol/address,
redirect/deadline/size/media protections. Results never forward API credentials.
The download disable switch and API/result origin overlays remain supported.
An absent overlay differs from an explicitly empty supplied restriction.

Preflight no longer requires KEK universally: ADR-0027 already supports database
secrets without KEK. Existing encrypted records are still resolved using their
pinned KEK; there is no implicit conversion. Preflight does not claim credential
decryption or external execution proof.

Official templates now request only real external connections, public URL and a
persistent authentication secret. Storage backend overrides, OIDC, SMTP and KEK
remain conditional integrations. Existing environment files must be retained on
upgrade rather than replaced with the new minimal example. Numerical timeout,
concurrency and byte limits retain their supported overrides; no new numerical
limits were introduced. Tests exercise minimal templates through actual parsers,
legacy explicit overrides, transport encoding, storage identity stability,
malformed restrictions and independent network protections. CI runs these gates.

Optional numeric/boolean tuning and image-owned defaults also treat blank scalar
placeholders as omitted. Blank Adapter/origin environment lists use ordinary
defaults; nonempty malformed lists still fail. Explicit `false`, configured
restricted lists and empty JSON policy allowlists retain their meaning. This
avoids deployment-platform empty placeholders disabling core features.
