#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const environmentFile = join(repositoryRoot, ".env.local");
const turboEntrypoint = join(repositoryRoot, "node_modules/turbo/bin/turbo");
const checkOnly = process.argv.slice(2).includes("--check");
const startupTimeoutMilliseconds = 45_000;

function readPort(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

function required(value, name) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required local configuration: ${name}.`);
  }
  return normalized;
}

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (major !== 22 || !Number.isInteger(minor) || minor < 13) {
    throw new Error(
      `Kanvas requires Node.js >=22.13 <23; current version is ${version}.`,
    );
  }
}

export function loopbackHost(host) {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::") {
    return "::1";
  }
  return host;
}

export function formatHttpOrigin(host, port) {
  const normalizedHost = loopbackHost(host);
  const formattedHost = normalizedHost.includes(":")
    ? `[${normalizedHost}]`
    : normalizedHost;
  return `http://${formattedHost}:${port}`;
}

function readDevelopmentTargets(environment) {
  environment = { ...environment };
  for (const [urlName, hostName, portName] of [
    ["KANVAS_DATABASE_URL", "KANVAS_DATABASE_HOST", "KANVAS_DATABASE_PORT"],
    ["KANVAS_REDIS_URL", "KANVAS_REDIS_HOST", "KANVAS_REDIS_PORT"],
  ]) {
    if (environment[urlName]) {
      let url;
      try {
        url = new URL(environment[urlName]);
      } catch {
        throw new Error(`Invalid ${urlName}.`);
      }
      environment[hostName] = url.hostname.replace(/^\[|\]$/gu, "");
      environment[portName] = url.port || undefined;
    }
  }
  const databaseSocket = environment.KANVAS_DATABASE_SOCKET?.trim();
  return {
    applicationPorts: [
      {
        label: "Server",
        host: environment.KANVAS_HTTP_HOST?.trim() || "127.0.0.1",
        port: readPort(environment.KANVAS_HTTP_PORT, 3000, "KANVAS_HTTP_PORT"),
      },
      {
        label: "Worker health server",
        host: environment.KANVAS_WORKER_HEALTH_HOST?.trim() || "127.0.0.1",
        port: readPort(
          environment.KANVAS_WORKER_HEALTH_PORT,
          3001,
          "KANVAS_WORKER_HEALTH_PORT",
        ),
      },
      {
        label: "Web",
        host: "127.0.0.1",
        port: 5173,
      },
    ],
    infrastructure: [
      {
        label: "MySQL",
        ...(databaseSocket
          ? { path: databaseSocket }
          : {
              host: required(
                environment.KANVAS_DATABASE_HOST,
                "KANVAS_DATABASE_HOST",
              ),
              port: readPort(
                environment.KANVAS_DATABASE_PORT,
                3306,
                "KANVAS_DATABASE_PORT",
              ),
            }),
      },
      {
        label: "Redis",
        host: required(environment.KANVAS_REDIS_HOST, "KANVAS_REDIS_HOST"),
        port: readPort(
          environment.KANVAS_REDIS_PORT,
          6379,
          "KANVAS_REDIS_PORT",
        ),
      },
    ],
  };
}

function formatNetworkTarget(target) {
  return "path" in target ? target.path : `${target.host}:${target.port}`;
}

function runConfigCheck(workspace) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file-if-exists",
        environmentFile,
        "--env-file-if-exists",
        join(repositoryRoot, "apps", workspace, ".env.local"),
        "--import",
        "tsx",
        "src/main.ts",
        "--check-config",
      ],
      {
        cwd: join(repositoryRoot, "apps", workspace),
        env: process.env,
        stdio: "inherit",
      },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${workspace} configuration check failed${
            signal ? ` with ${signal}` : ` with exit code ${code}`
          }.`,
        ),
      );
    });
  });
}

function assertPortAvailable(target) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      rejectPromise(
        new Error(
          `${target.label} cannot use ${target.host}:${target.port}: ${
            error.code === "EADDRINUSE"
              ? "the port is already in use"
              : error.message
          }.`,
        ),
      );
    });
    server.listen(target.port, target.host, () => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  });
}

function assertReachable(target) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect(
      "path" in target
        ? { path: target.path }
        : { host: target.host, port: target.port },
    );
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectPromise(
        new Error(
          `${target.label} did not respond at ${formatNetworkTarget(target)}.`,
        ),
      );
    }, 2_000);
    timeout.unref();

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolvePromise();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(
        new Error(
          `${target.label} is unavailable at ${formatNetworkTarget(target)}: ${error.message}.`,
        ),
      );
    });
  });
}

async function runPreflight(targets) {
  console.log("[dev] Building Server and Worker workspace dependencies...");
  const dependencyBuild = spawn(
    process.execPath,
    [
      turboEntrypoint,
      "run",
      "build",
      "--filter=@kanvas/server^...",
      "--filter=@kanvas/worker^...",
      "--env-mode=loose",
      "--ui=stream",
    ],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  const dependencyBuildExit = await waitForExit(dependencyBuild);
  if (dependencyBuildExit.code !== 0) {
    throw new Error(
      `Workspace dependency build failed${
        dependencyBuildExit.signal
          ? ` with ${dependencyBuildExit.signal}`
          : ` with exit code ${dependencyBuildExit.code}`
      }.`,
    );
  }

  console.log("[dev] Validating Server and Worker configuration...");
  await Promise.all([runConfigCheck("server"), runConfigCheck("worker")]);

  console.log("[dev] Checking application ports and local infrastructure...");
  await Promise.all([
    ...targets.applicationPorts.map(assertPortAvailable),
    ...targets.infrastructure.map(assertReachable),
  ]);
  console.log("[dev] Preflight passed.");
}

function waitForExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

async function waitForEndpoint(endpoint, childState, abortSignal) {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  let lastStatus;
  let lastError;

  while (Date.now() < deadline && !abortSignal.aborted) {
    if (childState.exit) {
      throw new Error(
        `Development processes exited before ${endpoint.label} became ready.`,
      );
    }
    try {
      const response = await fetch(endpoint.url, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      lastStatus = response.status;
      if (response.ok) {
        if (endpoint.expectedStatus) {
          const body = await response.json();
          if (body.status !== endpoint.expectedStatus) {
            lastError = `unexpected status ${String(body.status)}`;
          } else {
            return;
          }
        } else {
          return;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 300);
    });
  }

  throw new Error(
    `${endpoint.label} was not ready within ${
      startupTimeoutMilliseconds / 1_000
    }s${lastStatus ? ` (last HTTP status ${lastStatus})` : ""}${
      lastError ? `: ${lastError}` : ""
    }.`,
  );
}

function signalProcessTree(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

async function stopDevelopmentProcesses(child, signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalProcessTree(child, signal);
  await Promise.race([
    waitForExit(child),
    new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 5_000);
    }),
  ]);
  if (child.exitCode === null) {
    signalProcessTree(child, "SIGKILL");
  }
}

async function startDevelopment(targets) {
  const server = targets.applicationPorts[0];
  const worker = targets.applicationPorts[1];
  const web = targets.applicationPorts[2];
  const serverOrigin = formatHttpOrigin(server.host, server.port);
  const workerOrigin = formatHttpOrigin(worker.host, worker.port);
  const webOrigin = formatHttpOrigin(web.host, web.port);

  console.log("[dev] Starting workspace watchers...");
  const child = spawn(
    process.execPath,
    [turboEntrypoint, "run", "dev", "--env-mode=loose", "--ui=stream"],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );
  const childState = { exit: undefined };
  const exitPromise = waitForExit(child).then((exit) => {
    childState.exit = exit;
    return exit;
  });
  let stopping = false;
  const forwardSignal = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`\n[dev] Received ${signal}; stopping workspace processes...`);
    signalProcessTree(child, signal);
  };
  const forwardInterrupt = () => {
    forwardSignal("SIGINT");
  };
  const forwardTermination = () => {
    forwardSignal("SIGTERM");
  };
  process.once("SIGINT", forwardInterrupt);
  process.once("SIGTERM", forwardTermination);

  const readinessAbort = new AbortController();
  try {
    await Promise.all([
      waitForEndpoint(
        {
          label: "Server",
          url: `${serverOrigin}/health/ready`,
          expectedStatus: "ok",
        },
        childState,
        readinessAbort.signal,
      ),
      waitForEndpoint(
        {
          label: "Worker",
          url: `${workerOrigin}/health/ready`,
          expectedStatus: "ok",
        },
        childState,
        readinessAbort.signal,
      ),
      waitForEndpoint(
        {
          label: "Web",
          url: webOrigin,
        },
        childState,
        readinessAbort.signal,
      ),
    ]);
    console.log("");
    console.log(`[dev] Kanvas is ready: ${webOrigin}`);
    console.log(`[dev] Server health: ${serverOrigin}/health/ready`);
    console.log(`[dev] Worker health: ${workerOrigin}/health/ready`);
    console.log("[dev] Press Ctrl+C to stop every development process.");
  } catch (error) {
    readinessAbort.abort();
    await stopDevelopmentProcesses(child);
    throw error;
  }

  const exit = await exitPromise;
  process.removeListener("SIGINT", forwardInterrupt);
  process.removeListener("SIGTERM", forwardTermination);
  if (!stopping && exit.code !== 0) {
    throw new Error(
      `Development processes stopped unexpectedly${
        exit.signal ? ` with ${exit.signal}` : ` with exit code ${exit.code}`
      }.`,
    );
  }
}

async function main() {
  process.chdir(repositoryRoot);
  assertSupportedNode();
  if (!existsSync(environmentFile)) {
    throw new Error(
      "Missing .env.local. Run `pnpm env:setup`, then configure local MySQL and Redis credentials.",
    );
  }
  if (!existsSync(turboEntrypoint)) {
    throw new Error(
      "Dependencies are not installed. Run `corepack pnpm install --frozen-lockfile` first.",
    );
  }

  process.loadEnvFile(environmentFile);
  const targets = readDevelopmentTargets(process.env);
  await runPreflight(targets);
  if (checkOnly) {
    return;
  }
  await startDevelopment(targets);
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      `[dev] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
