import type {
  ApplicationRuntime,
  ProviderRouteSnapshot,
} from "@kanvas/application";
import type {
  AppendProviderObservationOptions,
  ProviderInvocationClaim,
  ProviderInvocationStore,
} from "@kanvas/database/runtime";
import { createIdentityCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import { describe, expect, it, vi } from "vitest";

import {
  createProviderAdapterRegistry,
  type AsyncProviderAdapter,
} from "../src/provider/provider-adapter.js";
import { ProviderInvocationRunner } from "../src/provider/provider-invocation-runner.js";
import type { WorkerAttemptOutputMaterializer } from "../src/storage/worker-attempt-output-materializer.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const NOW = new Date("2026-08-03T12:00:00.000Z");

function providerRoute(
  firstIdentity: number,
  routeDigest: string,
  scopeDigest: string,
): ProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "test",
    apiSurface: "images.test",
    providerEndpointId: id(firstIdentity),
    credentialIdentityId: id(firstIdentity + 1),
    credentialIdentityEpoch: 1,
    modelDeploymentId: id(firstIdentity + 2),
    pricingRevisionId: id(firstIdentity + 3),
    pinnedSecretVersionId: id(firstIdentity + 4),
    credentialIdentityDigest: digest("9"),
    instancePolicyRevisionId: id(firstIdentity + 5),
    workspacePolicyRevisionId: id(firstIdentity + 6),
    routePolicyRevisionId: id(firstIdentity + 7),
    modelProfileRevisionId: id(firstIdentity + 8),
    budgetAccountId: id(firstIdentity + 9),
    routingMode: "kanvas_fixed",
    executionTransparency: "full",
    maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
    routeCandidateDigest: routeDigest,
    requestScopeDigest: scopeDigest,
    queryMode: "none",
    notFoundIsAuthoritative: false,
  });
}

describe("Provider Image Artifact I/O Bridge", () => {
  it("materializes image bytes before atomically adopting the resolved Artifact output", async () => {
    const route = providerRoute(1, digest("a"), digest("b"));
    const claim: ProviderInvocationClaim = Object.freeze({
      workKind: "submit",
      invocationId: id(3),
      capabilityRunId: id(4),
      attemptId: id(5),
      workflowRunId: id(6),
      nodeRunId: id(7),
      workspaceId: id(8),
      actorId: id(9),
      implementationRevisionId: id(10),
      implementationDigest: digest("c"),
      adapterKey: "test.image.provider",
      route,
      input: {
        sourceArtifactId: id(20),
      },
      compiledOutputMapping: {
        schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
        direction: "output" as const,
        expression: {
          op: "object" as const,
          properties: [
            [
              "imageArtifactId",
              {
                op: "source" as const,
                root: "result" as const,
                path: ["asset"] as const,
              },
            ] as const,
          ],
        },
      },
      stableRequestKey: "kanvas:v1:test-image",
      requestFingerprint: digest("d"),
      leaseGeneration: 1,
      executionGeneration: 7,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
      executionDeadlineAt: new Date(NOW.getTime() + 300_000),
    });
    const adapter: AsyncProviderAdapter = {
      adapterKey: "test.image.provider",
      queryMode: "none",
      notFoundIsAuthoritative: false,
      submit: vi.fn().mockResolvedValue({
        observationKey: "submit:test:succeeded",
        status: "succeeded",
        output: {
          asset: {
            $kanvas: "attempt-output-artifact/v1",
            outputRole: "primary",
            outputIndex: 0,
          },
        },
        outputs: [
          {
            outputRole: "primary",
            outputIndex: 0,
            artifactType: "image.generated",
            metadata: {},
            mediaType: "image/png",
            byteSize: "4",
            body: (async function* () {
              await Promise.resolve();
              yield new Uint8Array([137, 80, 78, 71]);
            })(),
          },
        ],
      }),
      query: vi.fn(),
    };
    let adopted: AppendProviderObservationOptions | undefined;
    const store = {
      markSubmissionStarted: vi.fn().mockResolvedValue(true),
      appendAndAdoptObservation: vi.fn(
        (options: AppendProviderObservationOptions) => {
          adopted = options;
          return Promise.resolve({
            recorded: true,
            adoption: "applied" as const,
            terminal: true,
          });
        },
      ),
    } as unknown as ProviderInvocationStore;
    const outputMaterializer = {
      materialize: vi.fn().mockResolvedValue([
        {
          uploadSessionId: id(21),
          storedObjectId: id(22),
          artifactId: id(23),
          attemptOutputId: id(24),
          outputRole: "primary",
          outputIndex: 0,
          artifactType: "image.generated",
          metadata: {},
        },
      ]),
    } satisfies WorkerAttemptOutputMaterializer;
    const runtime = {
      runtimeFence: {
        assertAllowed: vi.fn().mockResolvedValue({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
      },
    } as unknown as ApplicationRuntime;
    const ids = [id(30), id(31), id(32)];
    const runner = new ProviderInvocationRunner({
      runtime,
      store,
      adapters: createProviderAdapterRegistry([adapter]),
      outputMaterializer,
      nextId: () => ids.shift() ?? id(33),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim,
        leaseTokenHash: "a".repeat(64),
        source: "consumer",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executionStatus: "observed",
        status: "succeeded",
      }),
    );
    expect(outputMaterializer.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          workspaceId: claim.workspaceId,
          actorId: claim.actorId,
          attemptId: claim.attemptId,
          executionDeadlineAt: claim.executionDeadlineAt,
          executionTarget: "provider",
        },
      }),
    );
    expect(adopted).toEqual(
      expect.objectContaining({
        status: "succeeded",
        output: {
          imageArtifactId: id(23),
        },
        outputs: [
          expect.objectContaining({
            artifactId: id(23),
            outputRole: "primary",
          }),
        ],
      }),
    );
  });

  it("fails closed without repeating a paid image call when trusted Storage materialization fails", async () => {
    const route = providerRoute(40, digest("e"), digest("f"));
    const claim: ProviderInvocationClaim = Object.freeze({
      workKind: "submit",
      invocationId: id(42),
      capabilityRunId: id(43),
      attemptId: id(44),
      workflowRunId: id(45),
      nodeRunId: id(46),
      workspaceId: id(47),
      actorId: id(48),
      implementationRevisionId: id(49),
      implementationDigest: digest("1"),
      adapterKey: "test.image.materialization-failure",
      route,
      input: {
        sourceArtifactId: id(50),
      },
      compiledOutputMapping: createIdentityCapabilityMappingPlanV1("output"),
      stableRequestKey: "kanvas:v1:test-image-failure",
      requestFingerprint: digest("2"),
      leaseGeneration: 1,
      executionGeneration: 7,
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
      executionDeadlineAt: new Date(NOW.getTime() + 300_000),
    });
    const submit = vi.fn().mockResolvedValue({
      observationKey: "submit:test:image-created",
      providerRequestId: "req_image_created",
      status: "succeeded",
      output: {
        imageArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "primary",
          outputIndex: 0,
        },
      },
      outputs: [
        {
          outputRole: "primary",
          outputIndex: 0,
          artifactType: "image.generated",
          metadata: {},
          mediaType: "image/png",
          byteSize: "4",
          body: (async function* () {
            await Promise.resolve();
            yield new Uint8Array([137, 80, 78, 71]);
          })(),
        },
      ],
    });
    const adapter: AsyncProviderAdapter = {
      adapterKey: claim.adapterKey,
      queryMode: "none",
      notFoundIsAuthoritative: false,
      submit,
      query: vi.fn(),
    };
    const appendAndAdoptObservation = vi.fn().mockResolvedValue({
      recorded: true,
      adoption: "applied" as const,
      terminal: false,
    });
    const materialize = vi
      .fn()
      .mockRejectedValue(
        new Error("must not leak storage profile or object key"),
      );
    const runner = new ProviderInvocationRunner({
      runtime: {
        runtimeFence: {
          assertAllowed: vi.fn().mockResolvedValue({
            state: "ACTIVE",
            executionGeneration: 7,
            stateVersion: 1,
          }),
        },
      } as unknown as ApplicationRuntime,
      store: {
        markSubmissionStarted: vi.fn().mockResolvedValue(true),
        appendAndAdoptObservation,
      } as unknown as ProviderInvocationStore,
      adapters: createProviderAdapterRegistry([adapter]),
      outputMaterializer: {
        materialize,
      },
      nextId: () => id(51),
      now: () => NOW,
    });

    await expect(
      runner.run({
        claim,
        leaseTokenHash: "b".repeat(64),
        source: "consumer",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executionStatus: "observed",
        status: "failed",
      }),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(appendAndAdoptObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observationKey:
          "submit:test:image-created:output-materialization-failed:unqueryable",
        providerRequestId: "req_image_created",
        status: "failed",
        stableErrorCode: "provider.output_materialization_failed",
        retryability: "manual",
      }),
    );
    expect(
      JSON.stringify(appendAndAdoptObservation.mock.calls[0]?.[0]),
    ).not.toContain("storage profile or object key");
  });
});
