import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const entrypoint = fileURLToPath(new URL("./entrypoint.sh", import.meta.url));
async function run(args, variables = {}) {
  const directory = await mkdtemp(join(tmpdir(), "kanvas-entrypoint-"));
  const log = join(directory, "calls");
  try {
    await writeFile(
      join(directory, "node"),
      `#!/bin/sh
if [ "$1" = "-e" ]; then exec "$REAL_NODE_FOR_FIXTURE" "$@"; fi
printf '%s\\n' "$*" >> "$CALL_LOG"
if [ "\${2:-}" = "\${FAIL_COMMAND:-never}" ]; then exit 17; fi
`,
      { mode: 0o700 },
    );
    const result = spawnSync("/bin/sh", [entrypoint, ...args], {
      env: {
        PATH: `${directory}:/usr/bin:/bin`,
        CALL_LOG: log,
        REAL_NODE_FOR_FIXTURE: process.execPath,
        ...variables,
      },
      encoding: "utf8",
    });
    const calls = await readFile(log, "utf8").catch(() => "");
    return { ...result, calls: calls.trim().split("\n").filter(Boolean) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("default image migrates and verifies before starting the supervisor", async () => {
  const result = await run([]);
  assert.equal(result.status, 0);
  assert.match(result.calls[0], /main.js migrate$/);
  assert.match(result.calls[1], /main.js check$/);
  assert.match(result.calls[2], /supervisor.mjs$/);
  assert.equal(result.calls.length, 3);
});
test("restricted deployment performs no DDL", async () => {
  const result = await run(["all"], { KANVAS_DB_MIGRATION_MODE: "check" });
  assert.equal(result.status, 0);
  assert.match(result.calls[0], /main.js check$/);
  assert.match(result.calls[1], /supervisor.mjs$/);
  assert.equal(result.calls.length, 2);
});
test("Matrix-encoded check mode also performs no DDL", async () => {
  const result = await run(["all"], {
    KANVAS_CI_B64_DB_MIGRATION_MODE: Buffer.from("check").toString("base64url"),
    NODE_OPTIONS: `--import=${new URL("./decode-env.mjs", import.meta.url).href}`,
  });
  assert.equal(result.status, 0);
  assert.match(result.calls[0], /main.js check$/);
  assert.equal(result.calls.length, 2);
});
for (const failure of ["migrate", "check"]) {
  test(`failed ${failure} never starts business processes`, async () => {
    const result = await run(["all"], { FAIL_COMMAND: failure });
    assert.equal(result.status, 17);
    assert.ok(result.calls.every((call) => !call.includes("supervisor")));
  });
}
test("unknown mode fails closed; explicit db commands do not bootstrap recursively", async () => {
  const bypass = await run(["all", "--check-config"]);
  assert.equal(bypass.status, 1);
  assert.deepEqual(bypass.calls, []);
  const invalid = await run(["all"], { KANVAS_DB_MIGRATION_MODE: "typo" });
  assert.equal(invalid.status, 1);
  assert.deepEqual(invalid.calls, []);
  const explicit = await run(["db", "status"]);
  assert.equal(explicit.status, 0);
  assert.equal(explicit.calls.length, 1);
  assert.match(explicit.calls[0], /main.js status$/);
});

test("preflight validates both roles and schema without migration", async () => {
  const result = await run([
    "preflight",
    "--workspace-id",
    "01K00000000000000000000000",
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, [
    "/app/server/dist/main.js --check-config",
    "/app/worker/dist/main.js --check-config",
    "/app/server/node_modules/@kanvas/database/dist/cli/main.js check",
    "/app/server/node_modules/@kanvas/database/dist/cli/deployment-readiness.js --workspace-id 01K00000000000000000000000",
  ]);
});
test("backup and recovery use the packaged tools without running migrations", async () => {
  for (const command of ["backup", "recovery"]) {
    const result = await run([command, "verify"]);
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, [
      `/app/recovery/dist/cli/main.js ${command} verify`,
    ]);
  }
});
