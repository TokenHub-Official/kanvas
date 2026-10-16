# Kubernetes standalone release

Default deployment: one image, one Deployment `kanvas`, one Pod and one container.
`workloads/` contains only this Deployment and its Service on port 8080.
`ingress.yaml` sends all paths to that Service. There is no external `server` DNS
requirement. Legacy split manifests are archived in `split-workloads/`; do not
apply them with the default release.

Render the namespace, release image, Ingress hostname/class/TLS and image pull
credentials in the operations environment. Create `kanvas-runtime` Secret using
`render-environment-secret.mjs`; it contains allowlisted ordinary environment values,
including non-secret settings. No ConfigMap is required by the default workload.
Do not log the renderer output or store it as a CI artifact.

`migrate-job.yaml` uses the same image, runs `kanvas-db migrate`, and reads a separate
`kanvas-migration` Secret for its DDL account. Its instance ID comes from the runtime
Secret. Provision the database and required permissions first. Give the Job a unique
name per attempt. A migration does not copy development data.

```sh
sh deploy/release-k8s.sh TARGET_NAMESPACE RENDERED_MIGRATION_JOB RENDERED_WORKLOAD_DIRECTORY
```

The script creates the Job, waits for success, then applies workloads and waits for
Deployment `kanvas`. Failure prevents rollout. Preserve failed Job evidence. Handle
schema-incompatible changes in a maintenance window; image rollback does not roll
back MySQL DDL. When migrating an existing split deployment, drain and remove its
old workload controllers deliberately; `kubectl apply` does not remove old resources.

The default uses one replica and Recreate, with deployment downtime. The Pod allows
600 seconds to terminate; the supervisor forces shutdown after 570 seconds. Requests
start at 100m CPU and 256Mi memory; limits are 1 CPU and 1Gi. These are initial trial settings,
not production load guarantees. No GPU or local model validation is implied. Measure
RSS, task concurrency and representative uploads before scaling membership.

Ingress must overwrite forwarded headers; count its hops plus the internal Nginx
hop in `KANVAS_HTTP_TRUSTED_PROXY_HOPS` (normally 2 with one ingress). Preserve
streaming/WebSocket support and allow the intended upload sizes and timeouts.
Public exposure is only 8080. Internal listeners are loopback-only in default mode.
Liveness/readiness/startup are served on `/health/live`, `/health/ready`,
`/health/startup` and aggregate both Node services through real Nginx.

[Runtime lifecycle](../runtime/README.md)
