import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { supervise } from "./supervisor.mjs";

const fixture = `
const fs = require('fs');
const [file, mode] = process.argv.slice(1);
process.on('SIGTERM', () => { if(mode !== 'hang') { fs.appendFileSync(file, 'term'); process.exit(0); } });
process.on('SIGQUIT', () => { fs.appendFileSync(file, 'quit'); process.exit(0); });
fs.writeFileSync(file, 'ready:');
setInterval(() => {}, 1000);
`;
async function waitReady(files) {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (
      (
        await Promise.all(
          files.map((file) => readFile(file, "utf8").catch(() => "")),
        )
      ).every((text) => text.startsWith("ready:"))
    )
      return;
    if (Date.now() > deadline) throw Error("Fixtures did not start");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
for (const mode of ["normal", "failure", "hang"]) {
  test(`supervisor lifecycle: ${mode}`, { timeout: 10000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "kanvas-supervisor-"));
    let resolveExit;
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    let ready = true;
    const files = ["server", "worker", "web"].map((name) => join(root, name));
    const control = await supervise({
      host: "127.0.0.1",
      port: 0,
      graceMs: 300,
      probe: async (kind) => kind !== "ready" || ready,
      onExit: resolveExit,
      commands: ["server", "worker", "web"].map((name, index) => ({
        name,
        command: process.execPath,
        args: [
          "-e",
          fixture,
          files[index],
          name === "worker" ? mode : "normal",
        ],
      })),
    });
    try {
      await waitReady(files);
      const health = async (kind) => {
        const response = await fetch(
          `http://127.0.0.1:${control.address.port}/health/${kind}`,
        );
        await response.body.cancel();
        return response.status;
      };
      assert.equal(await health("ready"), 200);
      ready = false;
      assert.equal(await health("ready"), 503);
      assert.equal(await health("live"), 200);
      control.stop(mode === "failure");
      assert.equal(await exited, mode === "normal" ? 0 : 1);
      assert.match(await readFile(files[2], "utf8"), /quit/);
      if (mode !== "hang")
        assert.match(await readFile(files[0], "utf8"), /term/);
    } finally {
      control.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });
}
test(
  "an unexpected clean child exit fails the entire application",
  { timeout: 10000 },
  async () => {
    let resolveExit;
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    await supervise({
      port: 0,
      graceMs: 100,
      probe: async () => true,
      onExit: resolveExit,
      commands: [
        {
          name: "worker",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
        {
          name: "server",
          command: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
        },
      ],
    });
    assert.equal(await exited, 1);
  },
);
