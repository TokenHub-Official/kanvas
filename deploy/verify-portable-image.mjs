import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const image = process.argv[2];
if (!image) throw Error("Supply the already-built local image tag");
const stamp = Date.now(),
  net = "kanvas-portable-" + stamp,
  db = net + "-db",
  redis = net + "-redis",
  volume = net + "-objects";
let app = net + "-app";
const out = resolve("output/deployment/portable-runtime-" + stamp);
mkdirSync(out, { recursive: true, mode: 0o700 });
const created = [];
let network = false,
  volumeCreated = false;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 180000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const dockerAsync = async (...args) =>
  (
    await promisify(execFile)("docker", args, {
      encoding: "utf8",
      timeout: 180000,
    })
  ).stdout.trim();
const record = (name, value) => {
  writeFileSync(out + "/" + name + ".json", JSON.stringify(value, null, 2));
  console.log(name + ": " + JSON.stringify(value).slice(0, 350));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const env = {
  KANVAS_ENVIRONMENT: "production",
  KANVAS_INSTANCE_ID: "isolated-runtime",
  KANVAS_RELEASE_VERSION: "local-verification",
  KANVAS_DATABASE_URL: "mysql://kanvas:fixture-app@db/kanvas",
  KANVAS_REDIS_URL: "redis://:fixture-redis@redis/0",
  KANVAS_AUTH_BASE_URL: "https://kanvas.example.invalid",
  KANVAS_AUTH_SECRET: "fixture-auth-secret-longer-than-thirty-two-characters==",
  KANVAS_AUTH_EMAIL_PASSWORD_ENABLED: "true",
  KANVAS_HTTP_TRUSTED_PROXY_HOPS: "2",
  KANVAS_WORKER_ROLES:
    "orchestration,execution,provider-execution,agent,outbox-relay,scheduler,reconciler,maintenance",
  KANVAS_ENABLED_EXECUTION_TARGETS: "worker,provider",
  KANVAS_PROVIDER_ADAPTER_KEYS:
    "openai-compatible.chat-completions.v1,openai-compatible.images.generations.v1,gemini.generate-content.image.v1,openai.images.edits.v1,openai.image.upscale.reconstructive.v1,openai.image.canvas-expand.v1,openai.image.object-remove.v1,generation-tasks.image.upscale.reconstructive.v1,generation-tasks.image.canvas-expand.v1,generation-tasks.image.object-remove.v1,generation-tasks.image.generate.v1,generation-tasks.image.edit.v1",
  KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://provider.example.invalid",
  KANVAS_PROVIDER_ACTIVE_KEK_VERSION: "fixture-v1",
  KANVAS_PROVIDER_KEK_MAP_JSON: JSON.stringify({
    "fixture-v1": Buffer.alloc(32, 7).toString("base64"),
  }),
  KANVAS_STORAGE_KIND: "local",
  KANVAS_LOCAL_STORAGE_ROOT: "/objects",
  KANVAS_LOCAL_STORAGE_PROFILE_ID: "01K00000000000000000000020",
  KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
    "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
};
// Test both the legacy Matrix transport and ordinary direct variables.
env.KANVAS_LOCAL_STORAGE_ROOT = "/var/lib/kanvas/objects";
const argsEnv = (overrides = {}, encoded = true) =>
  Object.entries({ ...env, ...overrides }).flatMap(([k, v]) => [
    "-e",
    encoded
      ? "KANVAS_CI_B64_" +
        k.slice(7) +
        "=" +
        Buffer.from(v).toString("base64").replace(/=+$/, "")
      : k + "=" + v,
  ]);
const cli = (command, overrides = {}) =>
  docker(
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    net,
    ...argsEnv(overrides),
    image,
    "db",
    command,
  );
const sql = (text) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      db,
      "mysql",
      "-uroot",
      "-pfixture-root",
      "--batch",
      "--skip-column-names",
    ],
    { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const failure = (overrides, expectedMessage) => {
  try {
    docker(
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      net,
      ...argsEnv(overrides),
      image,
    );
    throw Error("Unexpected application startup");
  } catch (e) {
    if (e.message === "Unexpected application startup") throw e;
    const logs = String(e.stdout || "") + String(e.stderr || "");
    assert.ok(e.status !== 0);
    assert.ok(
      logs.includes(expectedMessage),
      "Wrong startup failure: " + logs.slice(-500),
    );
    assert.ok(!logs.includes("ready to claim"));
    return { exit: e.status, noWorkerStarted: true, reason: expectedMessage };
  }
};
const probe = () =>
  JSON.parse(
    docker(
      "exec",
      app,
      "node",
      "-e",
      `Promise.all(['startup','live','ready'].map(async p=>[p,(await fetch('http://127.0.0.1:8080/health/'+p,{signal:AbortSignal.timeout(3000)})).status])).then(x=>console.log(JSON.stringify(x))).catch(()=>process.exit(1))`,
    ),
  );
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      const p = probe();
      if (p.every((x) => x[1] === 200)) return p;
    } catch {
      /* The HTTP listener may still be starting. */
    }
    if (docker("inspect", "-f", "{{.State.Running}}", app) !== "true")
      throw Error("App exited before readiness");
    await pause(500);
  }
  throw Error("App readiness timeout");
}
function start(overrides = {}, encoded = true) {
  docker(
    "run",
    "-d",
    "--name",
    app,
    "--platform",
    "linux/amd64",
    "--network",
    net,
    "--read-only",
    "--tmpfs",
    "/tmp:mode=1777",
    "--memory",
    "1g",
    "--cpus",
    "1",
    "--mount",
    "type=volume,source=" + volume + ",target=/var/lib/kanvas/objects",
    ...argsEnv(overrides, encoded),
    image,
  );
  created.push(app);
}
try {
  record("image", docker("image", "inspect", "-f", "{{.Id}}", image));
  docker("network", "create", "--internal", net);
  network = true;
  docker(
    "run",
    "-d",
    "--name",
    db,
    "--network",
    net,
    "--network-alias",
    "db",
    "--tmpfs",
    "/var/lib/mysql:rw,size=1600m",
    "-e",
    "MYSQL_ROOT_PASSWORD=fixture-root",
    "-e",
    "MYSQL_DATABASE=kanvas",
    "-e",
    "MYSQL_USER=kanvas",
    "-e",
    "MYSQL_PASSWORD=fixture-app",
    "mysql:8.0.45",
    "--log-bin-trust-function-creators=OFF",
  );
  created.push(db);
  docker(
    "run",
    "-d",
    "--name",
    redis,
    "--network",
    net,
    "--network-alias",
    "redis",
    "redis:7.2.16-alpine@sha256:ccd6aa8d45ff3f033d6fa15b8cc1a50579f65c89f38cf9bb607a954c4f2128ed",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
    "--requirepass",
    "fixture-redis",
  );
  created.push(redis);
  let dbReady = false;
  for (let i = 0; i < 120; i++) {
    try {
      docker(
        "exec",
        db,
        "mysql",
        "-h127.0.0.1",
        "-ukanvas",
        "-pfixture-app",
        "kanvas",
        "-e",
        "SELECT 1",
      );
      dbReady = true;
      break;
    } catch {
      await pause(500);
    }
  }
  assert.ok(dbReady);
  sql(
    "REVOKE ALL PRIVILEGES ON kanvas.* FROM 'kanvas'@'%'; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON kanvas.* TO 'kanvas'@'%'; CREATE USER 'runtime'@'%' IDENTIFIED BY 'fixture-runtime'; GRANT SELECT,INSERT,UPDATE,DELETE ON kanvas.* TO 'runtime'@'%';",
  );
  const dml = {
    KANVAS_DATABASE_URL: "mysql://runtime:fixture-runtime@db/kanvas",
    KANVAS_DB_MIGRATION_MODE: "check",
  };
  assert.equal(JSON.parse(cli("status")).state, "uninitialized");
  record(
    "empty-check-blocked",
    failure(dml, "Database schema is uninitialized"),
  );
  record(
    "missing-ddl-blocked",
    failure(
      { ...dml, KANVAS_DB_MIGRATION_MODE: "auto" },
      "CREATE command denied",
    ),
  );
  docker("volume", "create", volume);
  volumeCreated = true;
  start();
  record("automatic-empty-install", await ready());
  assert.equal(JSON.parse(cli("status")).state, "current");
  assert.equal(sql("SELECT @@GLOBAL.log_bin_trust_function_creators"), "0");
  assert.equal(
    sql(
      "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='kanvas'",
    ),
    "0",
  );
  record("database-policy", { trust: 0, triggers: 0 });
  record(
    "wrong-instance-blocked",
    failure(
      { ...dml, KANVAS_INSTANCE_ID: "not-initialized" },
      "Instance runtime state is missing",
    ),
  );
  const history = sql(
    "SELECT name,checksum,state,applied_at FROM kanvas.kanvas_migration_history ORDER BY name",
  );
  const routes = JSON.parse(
    docker(
      "exec",
      app,
      "node",
      "-e",
      `Promise.all(['/','/login','/api/auth/get-session'].map(async p=>{const r=await fetch('http://127.0.0.1:8080'+p);const t=await r.text();return {path:p,status:r.status,html:t.includes('<html'),contentType:r.headers.get('content-type')}})).then(x=>console.log(JSON.stringify(x)))`,
    ),
  );
  assert.ok(routes.every((x) => x.status === 200));
  assert.ok(routes[0].html && routes[1].html);
  assert.ok(routes[2].contentType.includes("application/json"));
  record("routes", routes);
  docker(
    "exec",
    app,
    "node",
    "-e",
    "require('fs').writeFileSync('/var/lib/kanvas/objects/validation-persistence','retained');if(process.getuid()!==10001)process.exit(1)",
  );
  docker("stop", "--time", "5", redis);
  let withdrawn = false;
  for (let i = 0; i < 40; i++) {
    try {
      const p = probe();
      if (
        p.find((x) => x[0] === "live")[1] === 200 &&
        p.find((x) => x[0] === "ready")[1] === 503
      ) {
        record("redis-outage", p);
        withdrawn = true;
        break;
      }
    } catch {
      /* Poll until dependency readiness has been withdrawn. */
    }
    await pause(250);
  }
  assert.ok(withdrawn);
  docker("start", redis);
  record("redis-recovery", await ready());
  docker("stop", "--time", "30", app);
  assert.equal(
    docker("inspect", "-f", "{{.State.ExitCode}} {{.State.OOMKilled}}", app),
    "0 false",
  );
  docker("start", app);
  record("repeat-auto-start", await ready());
  assert.equal(
    sql(
      "SELECT name,checksum,state,applied_at FROM kanvas.kanvas_migration_history ORDER BY name",
    ),
    history,
  );
  docker("stop", "--time", "30", app);
  app = net + "-restricted";
  start(dml, true);
  record("dml-only-start", await ready());
  const setupOutput = docker(
    "exec",
    app,
    "kanvas",
    "admin",
    "--email=owner@example.invalid",
  );
  const setup = JSON.parse(setupOutput.slice(setupOutput.indexOf("{")));
  assert.equal(setup.bindingMode, "verified_email_hash");
  assert.equal(
    new URL(setup.setupUrl).origin,
    "https://kanvas.example.invalid",
  );
  record("admin-entrypoint", { issued: true, emailBound: true });
  assert.equal(
    docker(
      "exec",
      app,
      "node",
      "-e",
      "console.log(require('fs').readFileSync('/var/lib/kanvas/objects/validation-persistence','utf8'))",
    ),
    "retained",
  );
  record(
    "resources",
    docker(
      "stats",
      "--no-stream",
      "--format",
      "{{.MemUsage}} CPU={{.CPUPerc}}",
      app,
    ),
  );
  docker("stop", "--time", "30", app);
  app = net + "-restricted-direct";
  start(dml, false);
  record("dml-direct-start", await ready());
  docker("stop", "--time", "30", app);
  sql(
    "UPDATE kanvas.kanvas_migration_history SET state='failed' WHERE name='0002_instance_registration_email_verification_policy.sql'",
  );
  record("interrupted-history-blocked", failure(dml, "is failed;"));
  sql(
    "UPDATE kanvas.kanvas_migration_history SET state='applied' WHERE name='0002_instance_registration_email_verification_policy.sql'",
  );
  const baseline = readFileSync(
    resolve("packages/database/migrations/0000_initial_schema.sql"),
    "utf8",
  );
  const checksum = createHash("sha256").update(baseline).digest("hex");
  sql(
    "CREATE DATABASE kanvas_upgrade; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON kanvas_upgrade.* TO 'kanvas'@'%'; USE kanvas_upgrade; " +
      baseline +
      " CREATE TABLE kanvas_migration_history(name VARCHAR(255) PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL,release_version VARCHAR(120) NOT NULL,state VARCHAR(16) NOT NULL DEFAULT 'applied'); INSERT INTO kanvas_migration_history(name,checksum,applied_at,release_version) VALUES ('0000_initial_schema.sql','" +
      checksum +
      "',UTC_TIMESTAMP(3),'prior-release');",
  );
  const upgrade = {
    KANVAS_DATABASE_URL: "mysql://kanvas:fixture-app@db/kanvas_upgrade",
  };
  assert.equal(JSON.parse(cli("status", upgrade)).state, "pending");
  await Promise.all(
    [1, 2].map(() =>
      dockerAsync(
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--network",
        net,
        ...argsEnv(upgrade),
        image,
        "db",
        "migrate",
      ),
    ),
  );
  assert.equal(JSON.parse(cli("status", upgrade)).state, "current");
  assert.equal(
    sql(
      "SELECT COUNT(*) FROM kanvas_upgrade.kanvas_migration_history WHERE state='applied'",
    ),
    "3",
  );
  record("concurrent-upgrade", { state: "current", applied: 3 });
  // Exercise an actual partially committed DDL failure, not only a fabricated
  // failed-history record. This fixture is mounted solely into the isolated DB job.
  const migrationFixture = out + "/failing-migrations";
  mkdirSync(migrationFixture);
  for (const file of readdirSync("packages/database/migrations").filter(
    (name) => /^\d{4}_.*\.sql$/u.test(name),
  )) {
    copyFileSync(
      "packages/database/migrations/" + file,
      migrationFixture + "/" + file,
    );
  }
  writeFileSync(
    migrationFixture + "/0003_failure_probe.sql",
    "CREATE TABLE portable_partial_probe (id INT PRIMARY KEY); ALTER TABLE portable_missing_table ADD COLUMN impossible INT;\n",
  );
  const failedUpgradeArgs = [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    net,
    "--mount",
    "type=bind,source=" +
      migrationFixture +
      ",target=/app/server/node_modules/@kanvas/database/migrations,readonly",
    ...argsEnv(upgrade),
    image,
    "db",
    "migrate",
  ];
  for (const expected of [
    "migration.execution_failed",
    "migration.history_incomplete",
  ]) {
    let rejected = false;
    try {
      docker(...failedUpgradeArgs);
    } catch (error) {
      assert.ok(String(error.stderr).includes(expected));
      rejected = true;
    }
    assert.ok(rejected, "Unsafe upgrade/replay unexpectedly succeeded");
    assert.equal(
      sql(
        "SELECT state FROM kanvas_upgrade.kanvas_migration_history WHERE name='0003_failure_probe.sql'",
      ),
      "failed",
    );
    assert.equal(
      sql(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='kanvas_upgrade' AND table_name='portable_partial_probe'",
      ),
      "1",
    );
  }
  record("partial-ddl-failure", {
    durableFailure: true,
    automaticReplayRejected: true,
  });
  record(
    "result",
    "PASS: automatic installation, scoped privileges, repeat startup, DML runtime, concurrent upgrade, failure gates, health, persistence, shutdown. No model tasks submitted.",
  );
} catch (e) {
  console.error(String(e.stderr || e.message).slice(-1600));
  process.exitCode = 1;
} finally {
  for (const name of created) {
    try {
      writeFileSync(out + "/" + name + ".log", docker("logs", name));
    } catch {
      /* Preserve cleanup even if a stopped container has no logs. */
    }
    try {
      docker("rm", "-f", "-v", name);
    } catch {
      console.error("Failed to remove fixture container: " + name);
      process.exitCode = 1;
    }
  }
  if (volumeCreated)
    try {
      docker("volume", "rm", volume);
    } catch {
      console.error("Failed to remove fixture volume: " + volume);
      process.exitCode = 1;
    }
  if (network)
    try {
      docker("network", "rm", net);
    } catch {
      console.error("Failed to remove fixture network: " + net);
      process.exitCode = 1;
    }
  console.log("Evidence: " + out);
}
