import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const preload = new URL("./decode-env.mjs", import.meta.url).href;
function run(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("KANVAS_")) delete env[k];
  return spawnSync(
    process.execPath,
    [
      "--import",
      preload,
      "-e",
      "process.stdout.write(JSON.stringify({value:process.env.KANVAS_AUTH_OAUTH_CONFIG_JSON,transport:process.env.KANVAS_CI_B64_AUTH_OAUTH_CONFIG_JSON}))",
    ],
    { env: { ...env, ...extra }, encoding: "utf8" },
  );
}
test("Matrix transport preserves unicode, JSON, equals, quotes and newlines", () => {
  const value = JSON.stringify([{ clientSecret: '假,a=="b' }]) + "\n";
  const r = run({
    KANVAS_CI_B64_AUTH_OAUTH_CONFIG_JSON: Buffer.from(value)
      .toString("base64")
      .replace(/=+$/, ""),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { value });
});
test("bad transport and direct/encoded conflicts fail without echoing values", () => {
  for (const extra of [
    { KANVAS_CI_B64_AUTH_OAUTH_CONFIG_JSON: "bad=value" },
    {
      KANVAS_CI_B64_AUTH_OAUTH_CONFIG_JSON: "Zg",
      KANVAS_AUTH_OAUTH_CONFIG_JSON: "private-fixture",
    },
  ]) {
    const r = run(extra);
    assert.notEqual(r.status, 0);
    assert.ok(!r.stderr.includes("private-fixture"));
    assert.ok(!r.stderr.includes("bad=value"));
  }
});
test("ordinary environment remains compatible", () => {
  const r = run({ KANVAS_AUTH_OAUTH_CONFIG_JSON: "[]" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { value: "[]" });
});
