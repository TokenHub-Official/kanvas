import { writeSync } from "node:fs";

// Run only in a trusted deployment job and pipe directly into kubectl apply.
// Never save stdout as a CI artifact or print it in a job log.
const [namespace, name] = process.argv.slice(2);
if (
  !namespace ||
  !name ||
  ![namespace, name].every((value) => /^[a-z0-9][a-z0-9-]{0,62}$/u.test(value))
) {
  throw new Error("Supply a Kubernetes namespace and Secret name.");
}
const names = [
  "KANVAS_ENVIRONMENT",
  "KANVAS_INSTANCE_ID",
  "KANVAS_RELEASE_VERSION",
  "KANVAS_DB_MIGRATION_MODE",
  "KANVAS_DATABASE_SSL_CA_FILE",
  "KANVAS_REDIS_TLS_CA_FILE",
  "KANVAS_AUTH_BASE_URL",
  "KANVAS_AUTH_EMAIL_PASSWORD_ENABLED",
  "KANVAS_STORAGE_KIND",
  "KANVAS_OSS_STORAGE_PROFILE_ID",
  "KANVAS_OSS_ENDPOINT",
  "KANVAS_OSS_REGION",
  "KANVAS_OSS_BUCKET",
  "KANVAS_OSS_KEY_PREFIX",
  "KANVAS_PROVIDER_ACTIVE_KEK_VERSION",
  "KANVAS_PROVIDER_ADAPTER_KEYS",
  "KANVAS_PROVIDER_ALLOWED_ORIGINS",
  "KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED",
  "KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS",
  "KANVAS_PROVIDER_PROXY_URL",
  "KANVAS_ENABLED_EXECUTION_TARGETS",
  "KANVAS_WORKER_ROLES",
  "KANVAS_AGENT_RUN_CONCURRENCY",
  "KANVAS_HTTP_TRUSTED_PROXY_HOPS",

  "KANVAS_DATABASE_URL",
  "KANVAS_REDIS_URL",
  "KANVAS_AUTH_SECRET",
  "KANVAS_AUTH_OAUTH_CONFIG_JSON",
  "KANVAS_AUTH_EMAIL_SMTP_PASSWORD",
  "KANVAS_OSS_ACCESS_KEY_ID",
  "KANVAS_OSS_ACCESS_KEY_SECRET",
  "KANVAS_OSS_SECURITY_TOKEN",
  "KANVAS_S3_ACCESS_KEY_ID",
  "KANVAS_S3_SECRET_ACCESS_KEY",
  "KANVAS_S3_SESSION_TOKEN",
  "KANVAS_PROVIDER_KEK_MAP_JSON",
];
const stringData = Object.fromEntries(
  names.flatMap((key) => {
    const value = process.env[key];
    return value ? [[key, value]] : [];
  }),
);
for (const required of [
  "KANVAS_DATABASE_URL",
  "KANVAS_REDIS_URL",
  "KANVAS_AUTH_SECRET",
]) {
  if (!stringData[required]) throw new Error(`Missing ${required}.`);
}
writeSync(
  1,
  JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { namespace, name },
    type: "Opaque",
    stringData,
  }),
);
