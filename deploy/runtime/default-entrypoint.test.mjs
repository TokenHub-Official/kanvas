import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
const image = process.env.KANVAS_TEST_IMAGE;
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 20000 }).trim();
for (const scenario of ["stop", "worker-failure"]) {
  test(
    `default image entrypoint: ${scenario}`,
    { skip: !image, timeout: 30000 },
    async () => {
      const fixture = resolve(
        import.meta.dirname,
        "default-entrypoint-fixture.mjs",
      );
      const databaseFixture = resolve(
        import.meta.dirname,
        "default-database-fixture.mjs",
      );
      const id = docker(
        "run",
        "-d",
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:mode=1777",
        "-e",
        "KANVAS_INSTANCE_ID=fixture-instance",
        "--mount",
        `type=bind,source=${fixture},target=/app/server/dist/main.js,readonly`,
        "--mount",
        `type=bind,source=${fixture},target=/app/worker/dist/main.js,readonly`,
        "--mount",
        `type=bind,source=${databaseFixture},target=/app/server/node_modules/@kanvas/database/dist/cli/main.js,readonly`,
        image,
      );
      try {
        let ready = false;
        for (let i = 0; i < 50; i++) {
          try {
            docker(
              "exec",
              id,
              "node",
              "-e",
              "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            );
            ready = true;
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        assert.ok(ready, "default command never became ready");
        docker(
          "exec",
          id,
          "node",
          "-e",
          "require('fs').writeFileSync('/tmp/unready','')",
        );
        docker(
          "exec",
          id,
          "node",
          "-e",
          "Promise.all(['live','ready'].map(p=>fetch('http://127.0.0.1:8080/health/'+p).then(r=>r.status))).then(s=>process.exit(s[0]===200&&s[1]===503?0:1))",
        );
        if (scenario === "stop") docker("stop", "--time", "10", id);
        else
          docker(
            "exec",
            id,
            "node",
            "-e",
            "process.kill(Number(require('fs').readFileSync('/tmp/worker.pid','utf8')),'SIGKILL')",
          );
        const code = Number(docker("wait", id));
        assert.equal(code, scenario === "stop" ? 0 : 1);
      } finally {
        docker("rm", "-f", id);
      }
    },
  );
}
