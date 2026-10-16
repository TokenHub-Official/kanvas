import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import pino, { type Logger } from "pino";

import type { ServerConfig } from "./config.js";

export interface TelemetryLifecycle {
  shutdown(): Promise<void>;
}

export function createLogger(config: ServerConfig): Logger {
  return pino({
    level: process.env.KANVAS_LOG_LEVEL ?? "info",
    base: {
      service: "kanvas-server",
      serviceVersion: config.serviceVersion,
      processRole: "server",
    },
    redact: {
      paths: [
        "password",
        "secret",
        "token",
        "authorization",
        "cookie",
        "headers.authorization",
        "headers.cookie",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  });
}

export function startTelemetry(
  config: ServerConfig,
  logger: Logger,
): TelemetryLifecycle {
  if (!config.otlpEndpoint) {
    return Object.freeze({
      shutdown: () => Promise.resolve(),
    });
  }

  const endpoint = config.otlpEndpoint.replace(/\/$/u, "");
  const sdk = new NodeSDK({
    serviceName: "kanvas-server",
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 60_000,
    }),
  });

  try {
    sdk.start();
  } catch (error) {
    logger.warn(
      {
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "Telemetry startup failed; continuing without OTLP export.",
    );
    return Object.freeze({
      shutdown: () => Promise.resolve(),
    });
  }

  return Object.freeze({
    shutdown: () => sdk.shutdown(),
  });
}
