import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test(
  "test and default images share the same runtime build definition",
  {
    // The private deployment overlay is deliberately absent from public exports.
    skip: !existsSync(join(import.meta.dirname, "..", "Dockerfile.test")),
  },
  () => {
    // Test builds use the operations-managed mirror of the same image versions.
    const normalize = (source) =>
      source
        .replace(/FROM [^/\s]+\/tool\//g, "FROM ")
        .replace(/@sha256:[a-f0-9]{64}/g, "");
    assert.equal(
      normalize(
        readFileSync(
          join(import.meta.dirname, "..", "Dockerfile.test"),
          "utf8",
        ),
      ),
      normalize(
        readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8"),
      ),
    );
  },
);

function run(failure = "") {
  const root = mkdtempSync(join(tmpdir(), "kanvas-release-test-"));
  try {
    const log = join(root, "calls");
    writeFileSync(
      join(root, "kubectl"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$RELEASE_TEST_LOG"
if [ "$3" = "$RELEASE_TEST_FAILURE" ]; then exit 1; fi
if [ "$3" = create ]; then printf '%s' kanvas-migrate-test; fi
`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      "sh",
      [
        join(import.meta.dirname, "release-k8s.sh"),
        "test",
        "migration.yaml",
        "workloads",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          RELEASE_TEST_LOG: log,
          RELEASE_TEST_FAILURE: failure,
        },
      },
    );
    return { ...result, calls: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("release applies workloads only after migration completion", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls[0], /create -f migration.yaml/u);
  assert.match(
    result.calls[1],
    /wait --for=condition=complete job\/kanvas-migrate-test/u,
  );
  assert.match(result.calls[2], /apply -f workloads/u);
  assert.equal(
    result.calls.filter((call) => call.includes("rollout status")).length,
    1,
  );
});

test("failed or reused migration Job creation stops before waiting or applying", () => {
  const result = run("create");
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 1);
});

test("failed migration completion gate never applies workloads", () => {
  const result = run("wait");
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 2);
  assert.match(result.stderr, /Application rollout was not started/u);
});

test("failed workload apply prevents a successful rollout report", () => {
  const result = run("apply");
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 3);
});
