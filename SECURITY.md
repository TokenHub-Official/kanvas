# Security Policy

Kanvas is in pre-release development and does not yet have a supported stable
version.

## Reporting a vulnerability

Email [help@tokenhub.com](mailto:help@tokenhub.com) for a private security report.
When enabled, you can also use [GitHub private vulnerability reporting](https://github.com/TokenHub-Official/kanvas/security/advisories/new).
Do not open a public issue containing exploit details, credentials, user data,
or production addresses.

Include the affected version or commit, reproduction conditions, impact, a
minimal reproduction, and a suggested mitigation when possible. Remove API
keys, cookies, database contents, user material, and all unrelated sensitive
data.

## Scope

High-priority reports include:

- authentication or authorization bypasses;
- cross-workspace data access;
- secret disclosure;
- uncontrolled provider egress;
- execution of untrusted Skills or files;
- object-storage boundary violations;
- budget or usage bypasses; and
- recovery or migration defects that can corrupt data.

Report a dependency advisory separately only when it is reachable through a
supported Kanvas path, and include that reachability evidence.

## Coordinated handling

Maintainers will acknowledge the report privately, reproduce and assess the
issue, prepare a fix, and coordinate disclosure. Keep details private until the
fix is available. Testing must not damage systems you do not own or access data
that is not required for the report.

## Dependency review notes

The current production audit retains one moderate `sprintf-js` advisory through
`@mastra/core -> gray-matter -> js-yaml 3 -> argparse`. The installed js-yaml library
entry does not load argparse; argparse is imported by its CLI. Kanvas uses the
library parser and does not expose that CLI to requests. This is a dependency-graph
finding with no identified application request path, not a claim that the package
is fixed. Keep the advisory visible in audit output; do not add an audit exclusion.
Reassess this boundary when changing YAML parsing or adding CLI execution. Upgrade
or remove the dependency when an upstream compatible fix is available.
