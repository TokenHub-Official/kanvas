import type {
  StorageUploadStore,
  UploadSessionRecord,
} from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import { createWorkerAttemptOutputMaterializer } from "../src/storage/worker-attempt-output-materializer.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const DEADLINE = new Date("2026-07-28T12:05:00.000Z");

function ulid(suffix: string): string {
  return `01K${"0".repeat(23 - suffix.length)}${suffix}`;
}

const ids = Object.freeze({
  workspace: ulid("1"),
  actor: ulid("2"),
  attempt: ulid("3"),
  probe: ulid("4"),
  upload: ulid("5"),
  storedObject: ulid("6"),
  artifact: ulid("7"),
  attemptOutput: ulid("8"),
  randomObject: ulid("9"),
  profile: ulid("10"),
});
const configurationHash = `sha256:${"a".repeat(64)}`;

describe("Worker Attempt output materializer", () => {
  it.each([false, true])(
    "materializes the same output when verification acknowledgement is lost: %s",
    async (lostAcknowledgement) => {
      const allocateUploadSession = vi.fn(
        (options: Parameters<StorageUploadStore["allocateUploadSession"]>[0]) =>
          Promise.resolve({
            id: options.id,
            workspaceId: options.workspaceId,
            actorId: options.actorId,
            purpose: options.purpose,
            attemptId: options.attemptId,
            outputRole: options.outputRole,
            outputIndex: options.outputIndex,
            expectedSize: options.expectedSize,
            expectedMediaType: options.expectedMediaType,
            storageProfileId: options.storageProfileId,
            compatibilityProbeId: options.compatibilityProbeId,
            profileConfigurationHash: options.profileConfigurationHash,
            container: options.container,
            objectKey: options.objectKey,
            uploadMode: options.uploadMode,
            writeProtectionMode: options.writeProtectionMode,
            state: "open",
            version: 1,
            expiresAt: options.expiresAt,
            cleanupEligibleAt: options.cleanupEligibleAt,
            verificationProfileVersion: options.verificationProfileVersion,
            replayed: false,
          } as UploadSessionRecord),
      );
      const ingest = vi.fn(
        async ({
          session,
          body,
          recoverStoredObjectOnly,
        }: {
          readonly session: UploadSessionRecord;
          readonly body: AsyncIterable<Uint8Array>;
          readonly recoverStoredObjectOnly?: true;
        }) => {
          if (recoverStoredObjectOnly)
            return {
              uploadSessionId: session.id,
              state: "verified" as const,
              replayed: true,
            };
          const chunks: number[] = [];
          for await (const chunk of body) {
            chunks.push(...chunk);
          }
          expect(chunks).toEqual([137, 80, 78, 71]);
          if (lostAcknowledgement)
            throw new Error("verification acknowledgement lost");
          return {
            uploadSessionId: session.id,
            state: "verified" as const,
            replayed: false,
          };
        },
      );
      const runtime = {
        profileId: ids.profile,
        profileConfigurationHash: configurationHash,
        container: "objects",
        maximumInputBytes: 1024,
        cleanupGraceMilliseconds: 60_000,
        verificationProfileVersion: "trusted-image-structural-v1",
        ensureCompatibilityProbe: vi.fn().mockResolvedValue({
          id: ids.probe,
        }),
        uploads: {
          ingest,
        },
      } as unknown as TrustedImageStorageRuntime;
      const nextId = vi
        .fn()
        .mockReturnValueOnce(ids.probe)
        .mockReturnValueOnce(ids.upload)
        .mockReturnValueOnce(ids.storedObject)
        .mockReturnValueOnce(ids.artifact)
        .mockReturnValueOnce(ids.attemptOutput)
        .mockReturnValueOnce(ids.randomObject);
      const materializer = createWorkerAttemptOutputMaterializer({
        runtime,
        store: {
          allocateUploadSession,
          readAttemptOutputUploadSession: async () => ({
            ...((await allocateUploadSession.mock.results[0]
              ?.value) as UploadSessionRecord),
            state: "verified",
          }),
        } as unknown as StorageUploadStore,
        nextId,
        now: () => NOW,
      });

      await expect(
        materializer.materialize({
          context: {
            workspaceId: ids.workspace,
            actorId: ids.actor,
            attemptId: ids.attempt,
            executionDeadlineAt: DEADLINE,
            executionTarget: "worker",
          },
          outputs: [
            {
              outputRole: "primary",
              outputIndex: 0,
              artifactType: "image.cutout",
              metadata: {
                background: "transparent",
              },
              mediaType: "image/png",
              byteSize: "4",
              body: (async function* () {
                await Promise.resolve();
                yield new Uint8Array([137, 80, 78, 71]);
              })(),
            },
          ],
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual([
        {
          uploadSessionId: ids.upload,
          storedObjectId: ids.storedObject,
          artifactId: ids.artifact,
          attemptOutputId: ids.attemptOutput,
          outputRole: "primary",
          outputIndex: 0,
          artifactType: "image.cutout",
          metadata: {
            background: "transparent",
          },
        },
      ]);
      expect(allocateUploadSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ids.upload,
          workspaceId: ids.workspace,
          actorId: ids.actor,
          purpose: "attempt_output",
          attemptId: ids.attempt,
          outputRole: "primary",
          outputIndex: 0,
          expectedSize: "4",
          expectedMediaType: "image/png",
          storageProfileId: ids.profile,
          compatibilityProbeId: ids.probe,
          profileConfigurationHash: configurationHash,
          objectKey: `v1/w/${ids.workspace}/a/${ids.attempt}/u/${ids.upload}/o/${ids.randomObject}`,
          expiresAt: DEADLINE,
          cleanupEligibleAt: new Date(DEADLINE.getTime() + 60_000),
        }),
      );
      expect(ingest).toHaveBeenCalledTimes(lostAcknowledgement ? 2 : 1);
      if (lostAcknowledgement)
        expect(ingest.mock.calls[1]?.[0]).toMatchObject({
          session: { id: ids.upload, state: "verified" },
          recoverStoredObjectOnly: true,
        });
    },
  );

  it("rejects duplicate output coordinates before allocating storage", async () => {
    const allocateUploadSession = vi.fn();
    const ensureCompatibilityProbe = vi.fn();
    const materializer = createWorkerAttemptOutputMaterializer({
      runtime: {
        maximumInputBytes: 1024,
        ensureCompatibilityProbe,
      } as unknown as TrustedImageStorageRuntime,
      store: {
        allocateUploadSession,
      } as unknown as StorageUploadStore,
      nextId: vi.fn(),
      now: () => NOW,
    });
    const output = {
      outputRole: "primary",
      outputIndex: 0,
      artifactType: "image.cutout",
      metadata: {},
      mediaType: "image/png" as const,
      body: (async function* () {
        await Promise.resolve();
        yield new Uint8Array([1]);
      })(),
    };

    await expect(
      materializer.materialize({
        context: {
          workspaceId: ids.workspace,
          actorId: ids.actor,
          attemptId: ids.attempt,
          executionDeadlineAt: DEADLINE,
          executionTarget: "worker",
        },
        outputs: [output, output],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/duplicated/u);
    expect(ensureCompatibilityProbe).not.toHaveBeenCalled();
    expect(allocateUploadSession).not.toHaveBeenCalled();
  });
});
