import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAwsS3CompatibleStorageAdapter,
  runStorageCompatibilityProbe,
} from "../src/index.js";

const endpoint = process.env.KANVAS_TEST_S3_ENDPOINT?.trim();
const accessKeyId = process.env.KANVAS_TEST_S3_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.KANVAS_TEST_S3_SECRET_ACCESS_KEY?.trim();
const enabled = Boolean(endpoint && accessKeyId && secretAccessKey);
const configuredEndpoint = endpoint ?? "";
const configuredAccessKeyId = accessKeyId ?? "";
const configuredSecretAccessKey = secretAccessKey ?? "";
const integration = enabled ? describe : describe.skip;
const profileId = "01K00000000000000000000991";
const bucket = `kanvas-s3-gate-${Date.now()}`;
const region = "us-east-1";
let administrationClient: S3Client | undefined;

integration("S3-compatible real endpoint gate", () => {
  beforeAll(async () => {
    administrationClient = new S3Client({
      endpoint: configuredEndpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: configuredAccessKeyId,
        secretAccessKey: configuredSecretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    await administrationClient.send(
      new CreateBucketCommand({ Bucket: bucket }),
    );
  });

  afterAll(async () => {
    if (administrationClient) {
      await administrationClient
        .send(new DeleteBucketCommand({ Bucket: bucket }))
        .catch(() => undefined);
      administrationClient.destroy();
    }
  });

  it("proves conditional create, checksum, range and exact idempotent deletion", async () => {
    const adapter = createAwsS3CompatibleStorageAdapter({
      storageProfileId: profileId,
      bucket,
      endpoint: configuredEndpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: configuredAccessKeyId,
        secretAccessKey: configuredSecretAccessKey,
      },
      encryption: { mode: "none" },
    });
    try {
      await expect(
        runStorageCompatibilityProbe(adapter, bucket),
      ).resolves.toMatchObject({
        adapterInitialized: true,
        serverOwnedWrite: true,
        sameKeyReplayRejected: true,
        immutableSealRecovery: true,
        fullObjectChecksum: true,
        rangeRead: true,
        idempotentExactDelete: true,
        distributedProfile: true,
      });
    } finally {
      await adapter.close?.();
    }
  });
});
