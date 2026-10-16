import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Child processes remain separate so a worker failure cannot leave a healthy web shell.
export async function supervise({
  commands,
  port = 3002,
  host = "127.0.0.1",
  graceMs = 570000,
  probe,
  onExit = (code) => process.exit(code),
}) {
  const children = new Map();
  let stopping = false;
  let failed = false;
  let timer;
  let finished = false;
  let timedOut = false;
  const signalChild = (child, signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const health = createServer(async (request, response) => {
    const kind = request.url?.match(/^\/health\/(live|ready|startup)$/)?.[1];
    if (!kind) {
      response.writeHead(404).end();
      return;
    }
    let ok = !stopping && children.size === commands.length;
    if (ok) {
      try {
        ok = await probe(kind);
      } catch {
        ok = false;
      }
    }
    response.writeHead(ok ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ status: ok ? "ok" : "not_ready" }));
  });
  await new Promise((resolve, reject) => {
    health.once("error", reject);
    health.listen(port, host, resolve);
  });
  const finish = () => {
    if (children.size || finished) return;
    finished = true;
    clearTimeout(timer);
    health.close();
    process.off("SIGTERM", terminate);
    process.off("SIGINT", terminate);
    onExit(failed ? 1 : 0);
  };
  const drainServer = () => {
    if (timedOut) return;
    if (!children.has("web") && !children.has("worker")) {
      const server = children.get("server");
      if (server) signalChild(server, "SIGTERM");
    }
  };
  const stop = (failure = false) => {
    failed ||= failure;
    if (stopping) return;
    stopping = true;
    timer = setTimeout(() => {
      failed = true;
      timedOut = true;
      for (const child of children.values()) signalChild(child, "SIGKILL");
    }, graceMs);
    for (const [name, child] of children) {
      if (name !== "server")
        signalChild(child, name === "web" ? "SIGQUIT" : "SIGTERM");
    }
    drainServer();
    finish();
  };
  const terminate = () => stop();
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  for (const { name, command, args = [], cwd, env } of commands) {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      detached: true,
    });
    children.set(name, child);
    child.once("error", () => {
      console.error(`Kanvas ${name} could not start.`);
      children.delete(name);
      stop(true);
      drainServer();
      finish();
    });
    child.once("exit", (code, signal) => {
      console.error(`Kanvas ${name} exited (${code ?? signal}).`);
      children.delete(name);
      // Even exit 0 is unexpected for a long-lived service before shutdown.
      if (!stopping) stop(true);
      else if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGQUIT")
        failed = true;
      drainServer();
      finish();
    });
  }
  return { stop, address: health.address() };
}

async function probe(kind) {
  const responses = await Promise.all(
    [3000, 3001].map(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/health/${kind}`, {
        signal: AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      return response.ok;
    }),
  );
  return responses.every(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await supervise({
    probe,
    commands: [
      {
        name: "server",
        command: process.execPath,
        args: ["dist/main.js"],
        cwd: "/app/server",
        env: { KANVAS_HTTP_HOST: "127.0.0.1", KANVAS_HTTP_PORT: "3000" },
      },
      {
        name: "worker",
        command: process.execPath,
        args: ["dist/main.js"],
        cwd: "/app/worker",
        env: {
          KANVAS_WORKER_HEALTH_HOST: "127.0.0.1",
          KANVAS_WORKER_HEALTH_PORT: "3001",
        },
      },
      { name: "web", command: "nginx", args: ["-g", "daemon off;"] },
    ],
  });
}
