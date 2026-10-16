import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as requestHttp } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  createLogger,
  defineConfig,
  type Logger,
  type Plugin,
  type ProxyOptions,
} from "vite";

import {
  developmentProxyRetryMilliseconds,
  isConnectionRefused,
  isExpectedStartupProxyRefusal,
} from "./src/development-api-proxy.js";

const browserRuntimeAssets = new Map([
  [
    "/onnxruntime/ort-wasm-simd-threaded.jsep.mjs",
    "text/javascript; charset=utf-8",
  ],
  ["/onnxruntime/ort-wasm-simd-threaded.jsep.wasm", "application/wasm"],
]);
const evalRoot = resolve(
  import.meta.dirname,
  "../../eval-data/background-remove",
);
const defaultDevelopmentApiOrigin = "http://127.0.0.1:3000";

function developmentApiOrigin(): URL {
  const candidate =
    process.env.KANVAS_WEB_DEV_API_ORIGIN?.trim() ||
    defaultDevelopmentApiOrigin;
  const url = new URL(candidate);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "KANVAS_WEB_DEV_API_ORIGIN must be a credential-free loopback HTTP origin.",
    );
  }
  return url;
}

const developmentApi = developmentApiOrigin();
const developmentServerStartedAt = Date.now();

function developmentLogger(): Logger {
  const logger = createLogger();
  const reportError = logger.error.bind(logger);
  let waitingReported = false;
  logger.error = (message, options) => {
    if (
      isExpectedStartupProxyRefusal(
        message,
        Date.now() - developmentServerStartedAt,
      )
    ) {
      if (!waitingReported) {
        logger.info(
          `[dev] Waiting for Server at ${developmentApi.origin}; suppressing repeated startup proxy errors.`,
          { timestamp: true },
        );
        waitingReported = true;
      }
      return;
    }
    reportError(message, options);
  };
  return logger;
}

function developmentProxy(): ProxyOptions {
  return {
    target: developmentApi.origin,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("error", (error, _request, response) => {
        if (
          !isConnectionRefused(error) ||
          !("req" in response) ||
          response.headersSent ||
          response.writableEnded
        ) {
          return;
        }
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/problem+json",
          "retry-after": String(developmentProxyRetryMilliseconds / 1_000),
        });
        response.end(
          JSON.stringify({
            type: "about:blank",
            title: "Development Server is starting",
            status: 503,
            code: "development.server_starting",
          }),
        );
      });
    },
  };
}

function boundedRequestBody(
  request: NodeJS.ReadableStream,
  maximumBytes = 64 * 1024 * 1024,
): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer | Uint8Array) => {
      length += chunk.byteLength;
      if (length > maximumBytes) {
        rejectBody(
          new RangeError("Development Eval payload exceeds the byte limit."),
        );
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once("end", () => {
      resolveBody(Buffer.concat(chunks, length));
    });
    request.once("error", rejectBody);
  });
}

function evalPath(relativePath: string): string | undefined {
  const path = resolve(evalRoot, relativePath);
  return path === evalRoot || path.startsWith(`${evalRoot}${sep}`)
    ? path
    : undefined;
}

function evalContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function browserRuntimeAssetsDevServer(): Plugin {
  return {
    name: "kanvas-browser-runtime-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1")
          .pathname;
        const contentType = browserRuntimeAssets.get(pathname);
        if (!contentType) {
          next();
          return;
        }
        const path = fileURLToPath(
          new URL(`./public${pathname}`, import.meta.url),
        );
        void readFile(path)
          .then((bytes) => {
            response.statusCode = 200;
            response.setHeader("content-type", contentType);
            response.setHeader("cache-control", "no-store");
            response.end(bytes);
          })
          .catch(next);
      });
    },
  };
}

function responseLossProbeDevServer(upstreamOrigin: URL): Plugin {
  const pendingCanvasExportStatusDrops = new Set<string>();
  const delayedUserImportSessions = new Set<string>();
  const droppedCanvasDraftCreateKeys = new Set<string>();
  let droppedInstanceSetupResponse = false;
  const droppedProviderCreateKeys = new Set<string>();
  const droppedProviderRotationKeys = new Set<string>();
  let droppedWorkspaceNameResponse = false;
  return {
    name: "kanvas-response-loss-probe",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const canvasExportCommit = url.pathname.match(
          /^\/api\/v1\/canvas-export-sessions\/([0-9A-HJKMNP-TV-Z]{26})\/commit$/u,
        );
        const canvasExportStatus = url.pathname.match(
          /^\/api\/v1\/canvas-export-sessions\/([0-9A-HJKMNP-TV-Z]{26})$/u,
        );
        const canvasExportSessionId =
          canvasExportCommit?.[1] ?? canvasExportStatus?.[1];
        const userImportContent = url.pathname.match(
          /^\/api\/v1\/user-import-upload-sessions\/([0-9A-HJKMNP-TV-Z]{26})\/content$/u,
        );
        const userImportSessionId = userImportContent?.[1];
        const dropCanvasExportCommit =
          request.method === "POST" &&
          Boolean(canvasExportCommit) &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit";
        const delayCanvasExportCommit =
          request.method === "POST" &&
          Boolean(canvasExportCommit) &&
          url.searchParams.get("kanvasDevDelay") === "before-commit";
        const delayCanvasDraftCreate =
          request.method === "POST" &&
          url.pathname === "/api/v1/canvas-drafts" &&
          url.searchParams.get("kanvasDevDelay") === "before-create";
        const delayWorkspaceAssetRead =
          request.method === "GET" &&
          /^\/api\/v1\/assets\/[0-9A-HJKMNP-TV-Z]{26}$/u.test(url.pathname) &&
          url.searchParams.get("kanvasDevDelay") === "asset-before-read";
        const delayArtifactContentRead =
          request.method === "GET" &&
          /^\/api\/v1\/artifacts\/[0-9A-HJKMNP-TV-Z]{26}\/content$/u.test(
            url.pathname,
          ) &&
          url.searchParams.get("kanvasDevDelay") === "artifact-before-read";
        const dropCanvasExportStatus =
          request.method === "GET" &&
          Boolean(canvasExportStatus) &&
          Boolean(
            canvasExportSessionId &&
            pendingCanvasExportStatusDrops.has(canvasExportSessionId),
          );
        const dropAssetCommit =
          request.method === "POST" &&
          url.pathname === "/api/v1/assets" &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit";
        const dropInstanceSetupCommit =
          request.method === "POST" &&
          url.pathname === "/api/v1/instance/setup/redemptions" &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit" &&
          !droppedInstanceSetupResponse;
        const dropProviderCreateCommit =
          request.method === "POST" &&
          url.pathname === "/api/v1/provider-settings" &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit" &&
          typeof request.headers["idempotency-key"] === "string" &&
          !droppedProviderCreateKeys.has(request.headers["idempotency-key"]);
        const dropProviderRotationCommit =
          request.method === "POST" &&
          /^\/api\/v1\/provider-settings\/[0-9A-HJKMNP-TV-Z]{26}\/secret-rotations$/u.test(
            url.pathname,
          ) &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit" &&
          typeof request.headers["idempotency-key"] === "string" &&
          !droppedProviderRotationKeys.has(request.headers["idempotency-key"]);
        const dropWorkspaceNameCommit =
          request.method === "PATCH" &&
          url.pathname === "/api/v1/workspace-settings/name" &&
          url.searchParams.get("kanvasDevDropResponse") === "after-commit" &&
          !droppedWorkspaceNameResponse;
        const dropCanvasDraftCreate =
          request.method === "POST" &&
          url.pathname === "/api/v1/canvas-drafts" &&
          url.searchParams.get("kanvasDevDropResponse") === "after-create" &&
          typeof request.headers["idempotency-key"] === "string" &&
          !droppedCanvasDraftCreateKeys.has(request.headers["idempotency-key"]);
        const delayUserImportContent =
          request.method === "PUT" &&
          Boolean(userImportSessionId) &&
          url.searchParams.get("kanvasDevDelay") === "first-content" &&
          !delayedUserImportSessions.has(userImportSessionId ?? "");
        if (delayCanvasExportCommit) {
          setTimeout(next, 25_000);
          return;
        }
        if (delayCanvasDraftCreate) {
          setTimeout(next, 12_000);
          return;
        }
        if (delayWorkspaceAssetRead) {
          setTimeout(next, 12_000);
          return;
        }
        if (delayArtifactContentRead) {
          setTimeout(next, 12_000);
          return;
        }
        if (delayUserImportContent && userImportSessionId) {
          delayedUserImportSessions.add(userImportSessionId);
          setTimeout(next, 25_000);
          return;
        }
        if (
          !dropAssetCommit &&
          !dropInstanceSetupCommit &&
          !dropProviderCreateCommit &&
          !dropProviderRotationCommit &&
          !dropWorkspaceNameCommit &&
          !dropCanvasDraftCreate &&
          !dropCanvasExportCommit &&
          !dropCanvasExportStatus
        ) {
          next();
          return;
        }
        const upstream = requestHttp(
          {
            hostname: upstreamOrigin.hostname,
            port: upstreamOrigin.port,
            path: url.pathname,
            method: request.method,
            headers: {
              ...request.headers,
              host: upstreamOrigin.host,
            },
          },
          (upstreamResponse) => {
            upstreamResponse.resume();
            upstreamResponse.once("end", () => {
              if (
                dropCanvasExportCommit &&
                canvasExportSessionId &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                pendingCanvasExportStatusDrops.add(canvasExportSessionId);
              } else if (
                dropInstanceSetupCommit &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                droppedInstanceSetupResponse = true;
              } else if (
                dropProviderCreateCommit &&
                typeof request.headers["idempotency-key"] === "string" &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                droppedProviderCreateKeys.add(
                  request.headers["idempotency-key"],
                );
              } else if (
                dropProviderRotationCommit &&
                typeof request.headers["idempotency-key"] === "string" &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                droppedProviderRotationKeys.add(
                  request.headers["idempotency-key"],
                );
              } else if (
                dropWorkspaceNameCommit &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                droppedWorkspaceNameResponse = true;
              } else if (
                dropCanvasDraftCreate &&
                typeof request.headers["idempotency-key"] === "string" &&
                (upstreamResponse.statusCode ?? 500) >= 200 &&
                (upstreamResponse.statusCode ?? 500) < 300
              ) {
                droppedCanvasDraftCreateKeys.add(
                  request.headers["idempotency-key"],
                );
              } else if (dropCanvasExportStatus && canvasExportSessionId) {
                pendingCanvasExportStatusDrops.delete(canvasExportSessionId);
              }
              response.destroy(
                new Error("Kanvas development response-loss probe."),
              );
            });
          },
        );
        upstream.once("error", next);
        request.pipe(upstream);
      });
    },
  };
}

function backgroundRemoveEvalDevServer(): Plugin {
  return {
    name: "kanvas-background-remove-eval",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/__kanvas_eval") {
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ATOM-01 Browser Eval</title>
    <style>
      body { font: 15px/1.5 ui-monospace, monospace; margin: 32px; color: #18181b; }
      progress { width: min(720px, 100%); height: 20px; }
      pre { background: #f4f4f5; padding: 16px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>ATOM-01 Browser Eval</h1>
    <progress id="progress" value="0" max="30"></progress>
    <p id="status">准备运行</p>
    <pre id="output"></pre>
    <script type="module" src="/scripts/background-remove-eval-runner.js"></script>
  </body>
</html>`);
          return;
        }
        if (
          request.method === "GET" &&
          url.pathname === "/__kanvas_eval_isnet"
        ) {
          response.statusCode = 200;
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ATOM-01 IS-Net Browser Eval</title>
    <style>
      body { font: 15px/1.5 ui-monospace, monospace; margin: 32px; color: #18181b; }
      progress { width: min(720px, 100%); height: 20px; }
      pre { background: #f4f4f5; padding: 16px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>ATOM-01 IS-Net Browser Eval</h1>
    <progress id="progress" value="0" max="30"></progress>
    <p id="status">准备运行</p>
    <pre id="output"></pre>
    <script type="module" src="/scripts/isnet-browser-eval-runner.js"></script>
  </body>
</html>`);
          return;
        }
        if (
          request.method === "GET" &&
          url.pathname === "/__kanvas_eval/corpus.json"
        ) {
          void readFile(resolve(evalRoot, "corpus.json"))
            .then((bytes) => {
              response.statusCode = 200;
              response.setHeader("content-type", "application/json");
              response.setHeader("cache-control", "no-store");
              response.end(bytes);
            })
            .catch(next);
          return;
        }
        const filePrefix = "/__kanvas_eval/file/";
        if (request.method === "GET" && url.pathname.startsWith(filePrefix)) {
          const relativePath = decodeURIComponent(
            url.pathname.slice(filePrefix.length),
          );
          const path = evalPath(relativePath);
          if (!path) {
            response.statusCode = 400;
            response.end("Invalid Eval path.");
            return;
          }
          void readFile(path)
            .then((bytes) => {
              response.statusCode = 200;
              response.setHeader("content-type", evalContentType(path));
              response.setHeader("cache-control", "no-store");
              response.end(bytes);
            })
            .catch(next);
          return;
        }
        const maskPrefix = "/__kanvas_eval/browser-mask/";
        if (request.method === "POST" && url.pathname.startsWith(maskPrefix)) {
          const sampleId = url.pathname.slice(maskPrefix.length);
          if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(sampleId)) {
            response.statusCode = 400;
            response.end("Invalid Eval sample ID.");
            return;
          }
          void boundedRequestBody(request)
            .then(async (bytes) => {
              const directory = resolve(evalRoot, "browser/masks");
              await mkdir(directory, { recursive: true });
              await writeFile(resolve(directory, `${sampleId}.png`), bytes);
              response.statusCode = 204;
              response.end();
            })
            .catch(next);
          return;
        }
        if (
          request.method === "POST" &&
          url.pathname === "/__kanvas_eval/browser-results"
        ) {
          void boundedRequestBody(request, 2 * 1024 * 1024)
            .then(async (bytes) => {
              const directory = resolve(evalRoot, "browser");
              await mkdir(directory, { recursive: true });
              await writeFile(resolve(directory, "results.json"), bytes);
              response.statusCode = 204;
              response.end();
            })
            .catch(next);
          return;
        }
        const candidateMaskPrefix = "/__kanvas_eval/candidate-mask/";
        if (
          request.method === "POST" &&
          url.pathname.startsWith(candidateMaskPrefix)
        ) {
          const [directory, sampleId, ...extra] = url.pathname
            .slice(candidateMaskPrefix.length)
            .split("/");
          if (
            extra.length > 0 ||
            !directory ||
            !sampleId ||
            !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(directory) ||
            !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(sampleId)
          ) {
            response.statusCode = 400;
            response.end("Invalid candidate Eval identity.");
            return;
          }
          void boundedRequestBody(request)
            .then(async (bytes) => {
              const target = resolve(evalRoot, directory, "masks");
              await mkdir(target, { recursive: true });
              await writeFile(resolve(target, `${sampleId}.png`), bytes);
              response.statusCode = 204;
              response.end();
            })
            .catch(next);
          return;
        }
        const candidateResultsPrefix = "/__kanvas_eval/candidate-results/";
        if (
          request.method === "POST" &&
          url.pathname.startsWith(candidateResultsPrefix)
        ) {
          const directory = url.pathname.slice(candidateResultsPrefix.length);
          if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(directory)) {
            response.statusCode = 400;
            response.end("Invalid candidate Eval directory.");
            return;
          }
          void boundedRequestBody(request, 2 * 1024 * 1024)
            .then(async (bytes) => {
              const target = resolve(evalRoot, directory);
              await mkdir(target, { recursive: true });
              await writeFile(resolve(target, "results.json"), bytes);
              response.statusCode = 204;
              response.end();
            })
            .catch(next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  customLogger: developmentLogger(),
  plugins: [
    browserRuntimeAssetsDevServer(),
    responseLossProbeDevServer(developmentApi),
    backgroundRemoveEvalDevServer(),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": developmentProxy(),
      "/health": developmentProxy(),
    },
  },
  build: {
    sourcemap: process.env.KANVAS_WEB_SOURCEMAP === "true",
  },
});
