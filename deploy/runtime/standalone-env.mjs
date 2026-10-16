// Decode transport inputs before applying image defaults so explicit operator
// values retain precedence, including in child processes and offline preflight.
import "./decode-env.mjs";

const defaults = {
  KANVAS_ENVIRONMENT: "production",
  KANVAS_INSTANCE_ID: "kanvas",
  // The complete image includes one trusted Nginx hop. External proxies opt in.
  KANVAS_HTTP_TRUSTED_PROXY_HOPS: "1",
  KANVAS_WORKER_ROLES:
    "orchestration,execution,provider-execution,outbox-relay,scheduler,reconciler,maintenance,agent",
  KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
};
for (const [name, value] of Object.entries(defaults)) {
  if (!process.env[name]?.trim()) process.env[name] = value;
}

// Only the complete image owns this mounted, single-node object directory.
// Keep the identity shipped in earlier official templates: changing it would
// orphan persisted object references. Any explicit storage input opts out of
// this entire default group; never mix local defaults into S3/OSS or custom roots.
if (
  !Object.entries(process.env).some(
    ([key, value]) =>
      /^KANVAS_(?:STORAGE_KIND$|LOCAL_STORAGE_|S3_|OSS_)/u.test(key) &&
      Boolean(value?.trim()),
  )
) {
  process.env.KANVAS_STORAGE_KIND = "local";
  process.env.KANVAS_LOCAL_STORAGE_ROOT = "/var/lib/kanvas/objects";
  process.env.KANVAS_LOCAL_STORAGE_PROFILE_ID = "01K00000000000000000000020";
  process.env.KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK =
    "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT";
}
