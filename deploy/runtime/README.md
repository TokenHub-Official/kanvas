# Standalone runtime

Default Docker builds produce one image running Nginx, Server and Worker. The image
uses tini as PID 1 and a Node supervisor. Only port 8080 is public. All internal
HTTP listeners bind loopback (Server 3000, Worker 3001, supervisor 3002).

Commands: `all` (default), `server`, `worker`, `db migrate`, `db status`, `db check`, `db plan`, `admin --email=OWNER`.
`kanvas-db migrate` remains available for Kubernetes Job command overrides.
The complete image defaults to `KANVAS_DB_MIGRATION_MODE=auto`: initialize/upgrade,
verify the schema, then start business processes. Provision the database first.
For separate DDL credentials use a release Job and `KANVAS_DB_MIGRATION_MODE=check`;
split role commands default to this read-only mode. Failure prevents startup.

The supervisor treats any unexpected child exit, including exit 0, as failure.
It sends SIGQUIT to Nginx, SIGTERM to Worker, then SIGTERM to Server after Web and
Worker exit. A 570-second deadline kills remaining process groups and fails the
container. Kubernetes must allow at least 600 seconds. Run with read-only root
and writable /tmp; no /var/run mount is needed. Logs go to container stdout/stderr.

Health requests enter Nginx and aggregate Server and Worker endpoints. Readiness
failure removes traffic; liveness must not restart on a mere dependency outage.
The ingress MUST overwrite X-Forwarded-Proto and X-Forwarded-For. The API's trusted
proxy count includes this internal Nginx hop; review the real ingress topology.
Without a trusted ingress, do not trust client-supplied forwarded headers.

Default K8s resources (100m CPU request, 256Mi memory request, 1 CPU/1Gi limit) are
initial trial settings, not measured production capacity. All processes share the
limit. Model inference, preview processing and agent concurrency need separate
load measurement. Initial one replica uses Recreate: releases have downtime.
No local model execution is part of the packaging or lifecycle verification.

Optional role-separated deployment uses this SAME image with `server` or `worker`
arguments. Override the role's bind address to expose its listener where needed.
Legacy split image targets/manifests are retained only for existing installations.

## Legacy Matrix transport

The tested Matrix `record-v4` CLI splits `KEY=value` on every equals sign and can
produce an empty Kubernetes EnvVar name when a value contains `=`. The Kanvas CI
therefore sends unpadded Base64 as `KANVAS_CI_B64_<suffix>`. The image's Node preload
restores the ordinary `KANVAS_<suffix>` variables before configuration loading and
removes transport keys before spawning children. Existing direct variables remain
supported, but supplying both forms of a key fails rather than silently overriding.
GitLab variable names and values do not change. Base64 is transport encoding, NOT
encryption; workload-view permissions still grant access to these values.

The CICD change and this image update must be released together. Do not retry an
old pipeline/image against encoded transport settings. Native CLI tests used the
same image digest as CI in an isolated Docker network and a fake Kubernetes API:
raw JSON containing `=` reproduced an empty env name/rejection, while the complete
encoded CI script produced valid Deployment and Service requests. The resulting
fixture env was passed into the built application image: both role config checks
and JSON roundtrip passed. Real database initialization and OIDC login remain
separate target-environment gates, not proven by these offline transport tests.
