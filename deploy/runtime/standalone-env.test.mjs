import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const preload = new URL("./standalone-env.mjs", import.meta.url).href;
function run(
  extra = {},
  expression = "{roles:process.env.KANVAS_WORKER_ROLES,targets:process.env.KANVAS_ENABLED_EXECUTION_TARGETS}",
) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("KANVAS_") || key === "NODE_OPTIONS") delete env[key];
  }
  const result = spawnSync(
    process.execPath,
    ["--import", preload, "-e", `console.log(JSON.stringify(${expression}))`],
    { env: { ...env, ...extra }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("complete image wires Agent and Provider execution without operator role lists", () => {
  const result = run();
  assert.equal(result.targets, "worker,provider");
  assert.ok(result.roles.split(",").includes("agent"));
  assert.ok(result.roles.split(",").includes("provider-execution"));
});

test("explicit direct and transported restrictions take precedence", () => {
  assert.deepEqual(
    run({
      KANVAS_WORKER_ROLES: "execution",
      KANVAS_ENABLED_EXECUTION_TARGETS: "worker",
    }),
    { roles: "execution", targets: "worker" },
  );
  assert.deepEqual(
    run({
      KANVAS_CI_B64_WORKER_ROLES: Buffer.from("execution")
        .toString("base64")
        .replace(/=+$/, ""),
      KANVAS_CI_B64_ENABLED_EXECUTION_TARGETS: Buffer.from("worker")
        .toString("base64")
        .replace(/=+$/, ""),
    }),
    { roles: "execution", targets: "worker" },
  );
});

test("empty deployment placeholders receive the ordinary image defaults", () => {
  assert.deepEqual(
    run({ KANVAS_WORKER_ROLES: "", KANVAS_ENABLED_EXECUTION_TARGETS: "" }),
    run(),
  );
});

const storageExpression =
  "Object.fromEntries(Object.entries(process.env).filter(([key]) => /^KANVAS_(?:STORAGE_KIND$|LOCAL_STORAGE_|S3_|OSS_)/u.test(key)))";
test("official volume defaults retain the old template identity across restarts", () => {
  const first = run({}, storageExpression);
  assert.equal(first.KANVAS_STORAGE_KIND, "local");
  assert.equal(first.KANVAS_LOCAL_STORAGE_ROOT, "/var/lib/kanvas/objects");
  assert.equal(
    first.KANVAS_LOCAL_STORAGE_PROFILE_ID,
    "01K00000000000000000000020",
  );
  assert.deepEqual(run({}, storageExpression), first);
});
test("custom storage and partial external settings receive no local defaults", () => {
  for (const configured of [
    { KANVAS_STORAGE_KIND: "s3", KANVAS_S3_BUCKET: "existing" },
    { KANVAS_OSS_BUCKET: "existing" },
    {
      KANVAS_LOCAL_STORAGE_ROOT: "/existing",
      KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000021",
    },
  ])
    assert.deepEqual(run(configured, storageExpression), configured);
});
test("explicit installation identity and environment remain unchanged", () => {
  assert.deepEqual(
    run(
      { KANVAS_INSTANCE_ID: "existing", KANVAS_ENVIRONMENT: "test" },
      "{instance:process.env.KANVAS_INSTANCE_ID,environment:process.env.KANVAS_ENVIRONMENT}",
    ),
    { instance: "existing", environment: "test" },
  );
});

test("all explicit legacy deployment values survive the image preload unchanged", () => {
  const existing = {
    KANVAS_ENVIRONMENT: "production",
    KANVAS_INSTANCE_ID: "existing-instance",
    KANVAS_WORKER_ROLES: "execution,reconciler",
    KANVAS_ENABLED_EXECUTION_TARGETS: "worker",
    KANVAS_STORAGE_KIND: "local",
    KANVAS_LOCAL_STORAGE_ROOT: "/existing/objects",
    KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000021",
    KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
      "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
    KANVAS_HTTP_TRUSTED_PROXY_HOPS: "2",
    KANVAS_PROVIDER_ADAPTER_KEYS: "openai.responses.v1",
    KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.example.com",
    KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "false",
    KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: "https://results.example.com",
    KANVAS_PROVIDER_ACTIVE_KEK_VERSION: "existing-key",
    KANVAS_PROVIDER_KEK_MAP_FILE: "/existing/key-map.json",
    KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON:
      "fixture-policy-preserved-verbatim",
  };
  const actual = run(
    existing,
    'Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("KANVAS_")))',
  );
  assert.deepEqual(actual, existing);
});

test("empty optional storage placeholders do not suppress the official volume", () => {
  const env = run(
    { KANVAS_STORAGE_KIND: "", KANVAS_LOCAL_STORAGE_ROOT: " " },
    storageExpression,
  );
  assert.equal(env.KANVAS_STORAGE_KIND, "local");
  assert.equal(env.KANVAS_LOCAL_STORAGE_ROOT, "/var/lib/kanvas/objects");
});
