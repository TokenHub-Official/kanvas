# External tools: first vertical slice

Status: the two bundled examples passed focused automated checks and real Chrome
journey verification, including one authorized remote Provider call.

## User journey

Open **Resources → Tools** (`/w/:workspaceId/tools`). Two bundled HTML tools share
one isolated host:

- **Calculator** performs basic arithmetic entirely inside its frame. It receives
  no communication channel, credentials, workspace context, or execution grant.
- **Run a capability** discovers published user-invokable capabilities, renders
  simple scalar inputs, submits a run, queries its result, and requests cancellation.
  It requires `capability.run`. The initial example accepts at most twelve scalar
  fields and excludes Artifact inputs and nested schemas. An empty compatible
  catalogue is shown explicitly; the tool never invents a capability or binding.

The examples are source-controlled HTML documents imported as raw text. This slice
is not an arbitrary HTML uploader, remote URL embedder, extension marketplace, or
an installation/permission management system. The same-origin application must not
serve untrusted executable uploads as ordinary public HTML.

## Isolation and protocol

The host uses `srcDoc` with `sandbox="allow-scripts"`, without `allow-same-origin`,
forms, popups, downloads, or top-level navigation permissions. Each example declares
CSP with no network connections, external resources, form submissions, or base URL.
Inline script/style permission applies only to the bundled example document.

The calculator has no bridge. The capability example receives a fresh MessagePort
through a message sent directly to its exact frame window. Its opaque origin
requires `*` for that initial port transfer; no secrets or business data accompany
it. The child accepts initialization only from its parent. The host never accepts
global window messages as API requests. Unmount/reopen closes the previous port.

Request envelope:

```json
{
  "version": 1,
  "id": "unique-request-id",
  "method": "capabilities.list",
  "params": {}
}
```

Supported methods:

| Method              | Parameters              | Scope                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------- |
| `capabilities.list` | none                    | Public scalar capability descriptors and this tool's recovery input |
| `run.start`         | `capabilityId`, `input` | A currently available compatible Contract Revision                  |
| `run.status`        | none                    | Only this tool session's latest submitted Run                       |
| `run.cancel`        | none                    | Only this tool session's latest submitted Run                       |

Replies contain the protocol version, request ID, `ok`, and either `data` or a
bounded error code. The bridge rejects unknown methods, malformed/oversized
messages, conflicting request-ID reuse, excessive concurrent requests, and sessions
that exceed their receipt bound. Credentials, CSRF tokens, generic fetch/DOM access,
and raw exceptions never cross the bridge. Results are rendered as text, not HTML.

## Existing execution authority

`GET /api/v1/user-capabilities` is a public invocation catalogue protected by
`capability.run`. The database revalidates the Workspace authority and filters
active definitions, published Contracts, `supportedInvokers: user`, and available
Bindings. It returns at most 100 descriptors plus a truncation indication. It does
not return Provider routes, credentials, configuration, or administrator metadata.
Discovery is not an execution authorization or a guarantee of execution success.

The host re-reads discovery on start. Existing Capability Run endpoints reauthorize
execution, enforce contracts and policy, and perform normal budget, idempotency,
retry, cancellation, and Artifact processing. No new execution engine is introduced.
The example does not start browser executors or local models. If an existing
Binding selects browser execution, the UI explains the dependency and permits
cancellation. Operators should select a server-backed compatible capability.

## Recovery and results

Before submission the host retains its generated idempotency key, exact Contract
Revision, and input. Unknown transport outcomes retain that same key; retries
cannot silently change the input. Definitive input/authorization rejection permits
correction. Only one active Run is allowed per mounted tool session.

The latest receipt is stored in tab sessionStorage, partitioned by Principal and
Workspace, and restored when the tool is reopened. Storage is a recovery hint, not
authority. Server authorization is repeated on every read/write. When browser
storage is unavailable, recovery lasts only for the current mounted host. Closing
the tab does not cancel a server Run; task records remain the durable record.

This slice displays structured output, previews returned Artifacts through the
trusted host, permits authorized downloads, preserves server task records, and
supports refresh/cancel/reopen. Artifact IDs come from the server Run and its pinned
output declarations; the frame cannot request downloads of arbitrary IDs. Adoption
into Canvas/Assets, arbitrary package installation, remote authentication, and
Agent invocation are later slices.

## Focused verification

- Web bridge/session tests: allowlisted protocol, deduplication, permission denial,
  current catalogue checks, uncertain-submission replay, active-task exclusion,
  scoped recovery, cancellation, and scalar input eligibility.
- Server controller tests and generated OpenAPI/type checks.
- Disposable MySQL consumer-authority test: public catalogue projection,
  user-invoker eligibility, revoked Binding exclusion, and authority revocation.
- Browser interaction must use an existing Chrome extension session. Unit tests do
  not prove iframe CSP/port transfer, visual layout, or real Provider completion.

## Verification record (2026-09-23)

Passed: 20 focused web tests, 3 server controller tests, the disposable MySQL
consumer-authority integration test, Web/Server/Database type checks,
Contracts/Database compilation, focused ESLint, formatting, generated OpenAPI/client
types, web production bundling, architecture checks, documentation checks, and diff
whitespace checks. The MySQL runner cleaned up its isolated database and temporary
accounts. Earlier approval-service and Chrome connection failures were resolved.

The browser work used a new tab within the existing Chrome extension session,
without starting another browser. The completed result tab was retained for the
user. Desktop and 390 × 844 layouts were visually inspected. English checks passed,
and the original Chinese preference and viewport were restored.

| Journey                     | Observed evidence                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry                       | Resources navigation opens Tools; both examples are selectable                                                                                                                                                  |
| Calculator                  | `12 + 3 = 15`; divide by zero displays an error; correction plus Enter produces `3`; English decimal inputs produce `0.3`                                                                                       |
| Isolation and communication | Actual iframe uses only `allow-scripts` and `no-referrer`; embedded CSP denies network and form submission; private MessagePort discovers current capabilities and relays runs without credentials in the frame |
| Submission recovery         | An uncertain response retained the original input and key; reopening offered Retry submission, which resolved to one Run                                                                                        |
| Cancellation                | Queued Run `[redacted-resource-id]` restored after reopening, then reached `cancelled` with zero Provider invocations                                                                                           |
| Real execution              | Run `[redacted-resource-id]` reached `running`, survived tool reopening, and completed with exactly one Provider invocation                                                                                     |
| Result recovery             | Tool reopening, navigation away/back, and language switching retained the completed result                                                                                                                      |
| Preview and download        | Artifact `[redacted-resource-id]` rendered as the requested blue circle and downloaded successfully                                                                                                             |

The downloaded PNG was **772,613 bytes**. Its SHA-256 matched the StoredObject:

```text
a136942b4873c22464138485deb3d0904cadd83a93fc94e165a55e05740c5b1a
```

The Chrome automation download-event wait timed out, but the resulting file existed
in Downloads and its byte count/hash matched the database; the latter is the
completion evidence. No second model call was needed. The recorded
`provider_reported_charge` was **USD 0.012** (6,000 TokenHub quota), within the
existing USD 1 per-call route maximum. Only Provider execution, outbox relay, and
reconciler Worker roles were started; no local model or Agent execution ran.

### Problems found and fixed during browser acceptance

1. Sandboxed forms did not dispatch the submit-driven actions. Both examples now
   use explicit button click actions while keeping form/network restrictions. The
   calculator also handles Enter. The original browser reproduction passed after
   the change, and its standalone-script regression test now exercises click.
2. Completed image runs initially exposed only structured Artifact IDs. The host
   now renders trusted output declarations as previews with an authorized download
   action; raw structured results remain collapsed inside the example.
3. The original frame height clipped the form actions. The host frame height was
   adjusted and checked on desktop and narrow viewports.

Unrelated repository-wide check failures remain outside this slice: locale key
parity compares English `instanceAccess.pending.count_one/count_other` with Chinese
`count`; the inline-handler policy reports existing handlers in
`task-records-page.tsx`. These were not changed to mask failures. Concurrent Agent
home-page edits were preserved; the final Web type check passed after those edits
settled. No push or deployment was performed.
