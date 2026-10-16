import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { GenerationTasksObjectRemoveProviderAdapter } from "../src/provider/generation-tasks-image-object-remove-provider.js";
import type { AuthorizedProviderInvocationRequest } from "../src/provider/provider-adapter.js";
import type { ProviderHttpRequest } from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const parameterPolicies = Object.freeze({
  resolution: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  quality: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  outputFormat: Object.freeze({
    callerPolicy: "optional" as const,
  }),
});

function route(): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "newapi",
    apiSurface: "generation.tasks.v1",
    providerEndpointId: id(1),
    credentialIdentityId: id(2),
    credentialIdentityEpoch: 1,
    pinnedSecretVersionId: id(3),
    credentialIdentityDigest: digest("a"),
    instancePolicyRevisionId: id(4),
    workspacePolicyRevisionId: id(5),
    routePolicyRevisionId: id(6),
    modelProfileRevisionId: id(7),
    modelDeploymentId: id(8),
    pricingRevisionId: id(9),
    budgetAccountId: id(10),
    routingMode: "gateway_managed",
    executionTransparency: "partial",
    maximumCharge: {
      currencyCode: "USD",
      amount: "1",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "provider_request_id",
    notFoundIsAuthoritative: false,
    modelOperation: "image.edit",
    parameterPolicies,
    parameterPolicyDigest: digest("d"),
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
): ProviderInvocationExecutionContext {
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: Object.freeze({
      promptTemplate: "Remove only the selected object.{{guidanceBlock}}",
      providerParameters: Object.freeze({
        resolution: "1k",
        quality: "low",
        outputFormat: "jpeg",
      }),
    }),
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind: "newapi",
      baseUrl: "https://newapi.test/v1",
      canonicalOrigin: "https://newapi.test",
      regionCode: "private",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "image-task-model",
      modelProfileRevisionId: currentRoute.modelProfileRevisionId,
      modelProfile: {},
    }),
    pricing: Object.freeze({
      revisionId: currentRoute.pricingRevisionId,
      currencyCode: "USD",
      pricing: {},
    }),
    secret: Object.freeze({
      id: currentRoute.pinnedSecretVersionId,
      workspaceId: id(12),
      credentialId: currentRoute.credentialIdentityId,
      version: 1,
      materialGeneration: 1,
      sourceKind: "deployment_reference",
      lifecycleStatus: "active",
      aadDigest: digest("e"),
      materialFingerprint: digest("f"),
      formatVersion: 1,
      drainDeadlineAt: null,
      deploymentReference: "deployment://provider/newapi",
    }),
  });
}

describe("Generation Tasks object-remove Provider Adapter", () => {
  it("persists effective parameters and business state before replaying the exact prepared request", async () => {
    const source = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: {
          r: 20,
          g: 30,
          b: 40,
        },
      },
    })
      .png()
      .toBuffer();
    const mask = await sharp(Buffer.from([0, 255, 0, 0, 0, 0]), {
      raw: {
        width: 3,
        height: 2,
        channels: 1,
      },
    })
      .png()
      .toBuffer();
    const requestHttp = vi.fn((request: ProviderHttpRequest) => {
      void request;
      return Promise.resolve({
        statusCode: 200,
        headers: {},
        body: {
          code: "success",
          data: {
            task_id: "task_remove_snapshot",
            status: "queued",
            created_at: 1,
          },
        },
      });
    });
    const adapter = new GenerationTasksObjectRemoveProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route();
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:object-remove",
      requestFingerprint: digest("9"),
      input: {
        sourceArtifactId: id(20),
        maskArtifactId: id(22),
        guidance: "Continue the neutral background.",
        resolution: "1k",
        quality: "low",
        outputFormat: "jpeg",
      },
      effectiveParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("provider-test-key", "utf8"),
      inputArtifacts: {
        open: vi.fn(({ inputPointer }) => {
          const isMask = inputPointer === "/maskArtifactId";
          const bytes = isMask ? mask : source;
          return Promise.resolve({
            artifactId: isMask ? id(22) : id(20),
            storedObjectId: id(isMask ? 24 : 23),
            artifactType: isMask ? "image.mask" : "image.source",
            dataClassification: "confidential" as const,
            byteSize: String(bytes.byteLength),
            sha256: "1".repeat(64),
            mediaType: "image/png" as const,
            body: (async function* () {
              await Promise.resolve();
              yield bytes;
            })(),
          });
        }),
      },
    };
    const prepared = adapter.prepare(request);
    expect(prepared.snapshot).toMatchObject({
      operation: "image.edit",
      body: {
        prompt:
          "Remove only the selected object.\nRemoval guidance: Continue the neutral background.",
        resolution: "2k",
        quality: "high",
        output_format: "png",
      },
      adapterState: {
        sourceArtifactId: id(20),
        maskArtifactId: id(22),
        guidance: "Continue the neutral background.",
      },
      result: {
        outputRole: "repaired",
        artifactType: "image.object-removed",
      },
    });
    expect(JSON.stringify(prepared.snapshot)).not.toContain(
      "provider-test-key",
    );
    expect(JSON.stringify(prepared.snapshot)).not.toContain("data:image/");

    await expect(
      adapter.submit(
        {
          ...request,
          input: {
            sourceArtifactId: id(90),
            maskArtifactId: id(91),
            guidance: "Changed after prepare.",
          },
          effectiveParameters: {
            resolution: "1k",
            quality: "low",
            outputFormat: "jpeg",
          },
          preparedRequestSnapshot: prepared.snapshot,
          preparedRequestDigest: digestProviderValue(prepared.snapshot),
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      providerRequestId: "task_remove_snapshot",
    });

    const body = requestHttp.mock.calls[0]?.[0].body as
      Readonly<Record<string, unknown>> | undefined;
    expect(body).toMatchObject({
      resolution: "2k",
      quality: "high",
      output_format: "png",
    });
    expect(body?.images).toEqual([
      expect.stringMatching(/^data:image\/png;base64,/u),
      expect.stringMatching(/^data:image\/png;base64,/u),
    ]);
    expect(JSON.stringify(body)).not.toContain("Changed after prepare");
  });
});
