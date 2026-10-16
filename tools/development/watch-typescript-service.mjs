#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = process.cwd();
const repositoryRoot = resolve(workspaceRoot, "../..");
const entrypoint = resolve(workspaceRoot, process.argv[2] || "dist/main.js");
const typescriptEntrypoint = join(
  workspaceRoot,
  "node_modules/typescript/bin/tsc",
);

function run(arguments_, options = {}) {
  return spawn(process.execPath, arguments_, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

function waitForExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function observeCompilerWatch(compiler, onSuccessfulCompilation) {
  let output = "";
  let compilationCount = 0;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });

  compiler.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    output = `${output}${chunk.toString()}`.slice(-2_048);
    const marker = "Found 0 errors. Watching for file changes.";
    let markerIndex = output.indexOf(marker);
    while (markerIndex !== -1) {
      compilationCount += 1;
      if (compilationCount === 1) {
        resolveReady();
      } else {
        onSuccessfulCompilation();
      }
      output = output.slice(markerIndex + marker.length);
      markerIndex = output.indexOf(marker);
    }
  });
  compiler.once("error", rejectReady);
  compiler.once("exit", (code, signal) => {
    if (compilationCount === 0) {
      rejectReady(
        new Error(
          `TypeScript watch stopped before its initial compilation${
            signal ? ` with ${signal}` : ` with exit code ${code}`
          }.`,
        ),
      );
    }
  });
  return ready;
}

async function compileOnce() {
  const compiler = run([typescriptEntrypoint, "-p", "tsconfig.build.json"]);
  const exit = await waitForExit(compiler);
  if (exit.code !== 0) {
    throw new Error(
      `Initial TypeScript compilation failed${
        exit.signal ? ` with ${exit.signal}` : ` with exit code ${exit.code}`
      }.`,
    );
  }
}

function stop(child, signal = "SIGTERM") {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

function watchWorkspacePackageBuilds(onBuildOutputChange) {
  const packagesRoot = join(repositoryRoot, "packages");
  let restartTimer;
  const watcher = watch(
    packagesRoot,
    { recursive: true },
    (_eventType, filename) => {
      if (!filename || !filename.split(/[\\/]/u).includes("dist")) {
        return;
      }
      clearTimeout(restartTimer);
      restartTimer = setTimeout(onBuildOutputChange, 200);
    },
  );
  return {
    close() {
      clearTimeout(restartTimer);
      watcher.close();
    },
  };
}

async function main() {
  if (!existsSync(typescriptEntrypoint)) {
    throw new Error(`TypeScript is not installed in ${workspaceRoot}.`);
  }

  await compileOnce();
  if (!existsSync(entrypoint)) {
    throw new Error(
      `Compiled service entrypoint was not created: ${entrypoint}.`,
    );
  }

  const compiler = run(
    [
      typescriptEntrypoint,
      "-p",
      "tsconfig.build.json",
      "--watch",
      "--preserveWatchOutput",
    ],
    {
      stdio: ["inherit", "pipe", "inherit"],
    },
  );

  let stopping = false;
  let runtime;
  let restartQueue = Promise.resolve();
  const expectedRuntimeExits = new WeakSet();
  let resolveUnexpectedRuntimeExit;
  const unexpectedRuntimeExit = new Promise((resolvePromise) => {
    resolveUnexpectedRuntimeExit = resolvePromise;
  });

  const startRuntime = () => {
    const child = run(["--enable-source-maps", entrypoint]);
    child.once("error", (error) => {
      resolveUnexpectedRuntimeExit({
        processName: "Node runtime",
        code: 1,
        signal: undefined,
        error,
      });
    });
    child.once("exit", (code, signal) => {
      if (!stopping && !expectedRuntimeExits.has(child)) {
        resolveUnexpectedRuntimeExit({
          processName: "Node runtime",
          code,
          signal,
        });
      }
    });
    return child;
  };

  const restartRuntimeAfterCompilation = () => {
    restartQueue = restartQueue.then(async () => {
      const previousRuntime = runtime;
      if (previousRuntime) {
        expectedRuntimeExits.add(previousRuntime);
        stop(previousRuntime);
        await waitForExit(previousRuntime);
      }
      if (!stopping) {
        runtime = startRuntime();
      }
    });
  };

  await observeCompilerWatch(compiler, restartRuntimeAfterCompilation);
  const packageBuildWatcher = watchWorkspacePackageBuilds(
    restartRuntimeAfterCompilation,
  );
  runtime = startRuntime();

  const stopChildren = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    packageBuildWatcher.close();
    stop(compiler, signal);
    if (runtime) {
      expectedRuntimeExits.add(runtime);
      stop(runtime, signal);
    }
  };
  const handleInterrupt = () => {
    stopChildren("SIGINT");
  };
  const handleTermination = () => {
    stopChildren("SIGTERM");
  };
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleTermination);

  const firstExit = await Promise.race([
    waitForExit(compiler).then((exit) => ({
      processName: "TypeScript compiler",
      ...exit,
    })),
    unexpectedRuntimeExit,
  ]);

  const shutdownWasRequested = stopping;
  stopChildren("SIGTERM");
  process.removeListener("SIGINT", handleInterrupt);
  process.removeListener("SIGTERM", handleTermination);

  if (!shutdownWasRequested) {
    const exitDescription = firstExit.error
      ? `: ${firstExit.error.message}`
      : firstExit.signal
        ? ` with ${firstExit.signal}`
        : ` with exit code ${firstExit.code}`;
    throw new Error(`${firstExit.processName} stopped${exitDescription}.`);
  }
}

main().catch((error) => {
  console.error(
    `[dev] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
