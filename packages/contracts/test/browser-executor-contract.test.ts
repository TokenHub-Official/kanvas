import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  acknowledgeBrowserAttemptCancellationRoute,
  allocateBrowserAttemptOutputRoute,
  AllocateBrowserAttemptOutputBodySchema,
  claimBrowserAttemptRoute,
  CompleteBrowserAttemptBodySchema,
  completeBrowserAttemptRoute,
  heartbeatBrowserAttemptRoute,
  RegisterBrowserExecutorBodySchema,
  registerBrowserExecutorRoute,
  routeRegistry,
  uploadBrowserAttemptOutputRoute,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("browser executor API contracts", () => {
  it("separates Human Session commands from bounded Attempt Grant commands", () => {
    expect(registerBrowserExecutorRoute.security).toEqual(["browserSession"]);
    expect(claimBrowserAttemptRoute.security).toEqual(["browserSession"]);
    for (const route of [
      heartbeatBrowserAttemptRoute,
      allocateBrowserAttemptOutputRoute,
      uploadBrowserAttemptOutputRoute,
      completeBrowserAttemptRoute,
      acknowledgeBrowserAttemptCancellationRoute,
    ]) {
      expect(route.security).toEqual(["browserAttemptGrant"]);
      expect(routeRegistry).toContain(route);
    }
  });

  it("separates idempotent output allocation from bounded raw-byte ingestion", () => {
    expect(allocateBrowserAttemptOutputRoute.idempotency).toBe("required");
    expect(
      allocateBrowserAttemptOutputRoute.request?.headers?.required,
    ).toContain("idempotency-key");
    expect(uploadBrowserAttemptOutputRoute.method).toBe("PUT");
    expect(uploadBrowserAttemptOutputRoute.request?.rawBody).toEqual({
      contentTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      maximumBytes: 536_870_912,
    });

    const validate = createAjv().compile(
      AllocateBrowserAttemptOutputBodySchema,
    );
    expect(
      validate({
        controlPlaneVersion: 1,
        attemptId: "01K00000000000000000000003",
        leaseGeneration: 2,
        executionGeneration: 7,
        outputRole: "primary",
        outputIndex: 0,
        expectedSize: "68",
        expectedMediaType: "image/png",
      }),
    ).toBe(true);
    expect(
      validate({
        controlPlaneVersion: 1,
        attemptId: "01K00000000000000000000003",
        leaseGeneration: 2,
        executionGeneration: 7,
        outputRole: "primary",
        outputIndex: 0,
        expectedMediaType: "image/svg+xml",
      }),
    ).toBe(false);
  });

  it("accepts only a bounded capability declaration without raw hardware facts", () => {
    const validate = createAjv().compile(RegisterBrowserExecutorBodySchema);
    const body = {
      controlPlaneVersion: 1,
      runtimeReleaseId: "01K00000000000000000000001",
      runtimeReleaseDigest: digest("a"),
      capabilityManifestVersion: 1,
      capabilityManifestDigest: digest("b"),
      capabilities: [
        {
          implementationRevisionId: "01K00000000000000000000002",
          implementationDigest: digest("c"),
          adapterKey: "browser.remove-background",
          backend: "webgpu",
          probeProfileVersion: 1,
          probeResultDigest: digest("d"),
        },
      ],
    };

    expect(validate(body)).toBe(true);
    expect(
      validate({
        ...body,
        gpuModel: "raw fingerprint",
      }),
    ).toBe(false);
  });

  it("validates a replayable completion manifest without carrying the grant in JSON", () => {
    const validate = createAjv().compile(CompleteBrowserAttemptBodySchema);
    const body = {
      controlPlaneVersion: 1,
      attemptId: "01K00000000000000000000003",
      capabilityRunId: "01K00000000000000000000004",
      leaseGeneration: 2,
      executionGeneration: 7,
      implementationRevisionId: "01K00000000000000000000002",
      implementationDigest: digest("c"),
      adapterKey: "browser.remove-background",
      capabilityOutput: {
        foreground: true,
      },
      outputs: [],
      initialUsage: [
        {
          entryKey: "browser.duration",
          metricKey: "duration",
          valueDimension: "quantity",
          unitCode: "millisecond",
          entryKind: "observation",
          numericValue: "1250",
          evidenceDigest: digest("e"),
          observedAt: "2026-07-28T11:00:00.000Z",
        },
      ],
    };

    expect(validate(body)).toBe(true);
    expect(validate({ ...body, attemptGrant: "secret" })).toBe(false);
    expect(
      validate({
        ...body,
        initialUsage: [
          {
            ...body.initialUsage[0],
            observedAt: "client-ish-time",
          },
        ],
      }),
    ).toBe(false);
  });
});
