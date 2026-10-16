# Deployment and capability setup closure

Validated on 2026-09-19 (America/Los_Angeles), based on `4d93d8be`, on branch
`codex/deployment-capability-closure`.

## Delivered behavior

- First-owner setup installs system Runtime Adapters and registers recommendations
  in the same transaction. Release migration repairs existing active Workspaces.
  New definitions select their latest bundled revision; existing selection and
  disabled state survive repair. No demo business resources are installed.
- `kanvas preflight [--workspace-id ULID]` checks configuration/schema and reads
  Workspace prerequisites and Agent model readiness. Missing configuration returns
  exit 2; no repair or model invocation occurs. It explicitly reports that execution
  is not verified. Disabled optional adapters are reported without re-enabling them.
- Model settings retain unknown token limits as unknown. Text publication requires
  confirmed limits; non-text models can publish without invented text limits.
  Agent candidates explain missing prerequisites instead of an unexplained disabled
  selector. Reference sync no longer needs a demo Workspace administrator.
- The complete image contains the version-matched backup/recovery tools, with their
  migration inventory path supplied by the command entrypoint. These tools consume
  coordinated snapshots; snapshot scheduling and a real restore drill remain
  deployment responsibilities.
- GitLab's release gate includes focused model/API checks and disposable MySQL
  initialization, Agent selection and Provider publication tests.

## Evidence

- Disposable MySQL: 3 files / 11 tests passed. The initialization test exercises
  first-owner redemption, latest-revision initialization, response-loss replay,
  deletion of historical missing adapter facts, the real `db migrate` CLI repair,
  repeated repair, preserved old revision/disabled state and read-only preflight
  reporting unconfigured models. The other files cover Agent model selection and
  Provider publication facts. These tests do not invoke a model.
- Database installer/bootstrap unit tests: 8 passed.
- Model and Agent settings API tests: 9 passed, including non-text publication
  without token limits and text rejection before persistence when limits are absent.
- Model editor/reference tests: 6 passed. Model/Agent API contract tests: 5 passed.
- Deployment scripts, entrypoint, configuration transport and supervisor: 20 passed.
- Server dependency build and Server/Web/Database type checks passed. Changed-source
  ESLint, architecture, environment contract, document links, maintained document
  language, inline-handler checks and `git diff --check` passed.
- Final full Docker build succeeded as `kanvas:launch-closure-local`:
  `sha256:f5f1f6f6256a0467af6e975f833713c15d576103a16bd9a90b9e57280100a450`.
  Image size: 1,505,164,043 bytes. Docker disk exhaustion was resolved by removing
  only this task's obsolete image and identified build-cache records.
- `sh deploy/verify-image.sh standalone kanvas:launch-closure-local` passed:
  no packaged environment files, migration help/plan, bundled catalog, recovery
  command help, preflight packaging, both role configuration parsers, Nginx syntax,
  SPA/API routing, upload, HTTPS forwarding, SSE, WebSocket, health and SIGTERM.
  Network-isolated image checks use simulated backends, not live application E2E.

## Target-environment boundary

The existing Chrome session showed the test deployment still using image
`d273cfe998a0ec3394bedd40b09644c28a950f40`, and its Agent model selectors were
unavailable. This change has not replaced that deployment or modified its database,
model metadata, credentials or budget. No local model inference was executed.

After publishing the candidate image, run the release migration, complete actual
Provider/model/budget/capability binding configuration, and run preflight inside
that same image. Then verify a representative authorized Agent/Capability run,
result download and controlled restart, recording the image, Workspace and Run IDs.
A passing build or preflight alone must not be reported as that live acceptance.
