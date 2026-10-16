import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadStorageAdapterConfig,
  loadTrustedImageStorageConfig,
} from "../src/index.js";

const profileId = "01K00000000000000000000001";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("storage runtime configuration", () => {
  it("keeps the same storage identity and limits for blank optional tuning", () => {
    const environment = {
      KANVAS_STORAGE_KIND: "local",
      KANVAS_LOCAL_STORAGE_ROOT: "/srv/kanvas/objects",
      KANVAS_LOCAL_STORAGE_PROFILE_ID: profileId,
      KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
        "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
    };
    expect(
      loadTrustedImageStorageConfig(
        {
          ...environment,
          KANVAS_STORAGE_MAX_INPUT_BYTES: "",
          KANVAS_STORAGE_MAX_IMAGE_WIDTH: " ",
        },
        "production",
      ),
    ).toEqual(loadTrustedImageStorageConfig(environment, "production"));
  });

  it("preserves the acknowledged Local Storage profile", () => {
    expect(
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "local",
          KANVAS_LOCAL_STORAGE_PROFILE_ID: profileId,
          KANVAS_LOCAL_STORAGE_ROOT: "/srv/kanvas/objects",
          KANVAS_LOCAL_STORAGE_TRUSTED_ROOT_ACK:
            "I_ACKNOWLEDGE_SINGLE_NODE_TRUSTED_STORAGE_ROOT",
        },
        "production",
      ),
    ).toEqual({
      kind: "local",
      profileId,
      container: "objects",
      rootDirectory: "/srv/kanvas/objects",
    });
  });

  it("parses a bounded HTTPS S3 profile without persisting credentials in public facts", () => {
    expect(
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_S3_STORAGE_PROFILE_ID: profileId,
          KANVAS_S3_ENDPOINT: "https://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
          KANVAS_S3_FORCE_PATH_STYLE: "false",
          KANVAS_S3_SERVER_SIDE_ENCRYPTION: "aws:kms",
          KANVAS_S3_KMS_KEY_ID: "alias/kanvas-storage",
        },
        "production",
      ),
    ).toMatchObject({
      kind: "s3",
      profileId,
      endpoint: "https://objects.example.com",
      region: "us-east-1",
      container: "kanvas-objects",
      forcePathStyle: false,
      encryption: {
        mode: "aws:kms",
        kmsKeyId: "alias/kanvas-storage",
      },
    });
  });

  it("loads production static credentials from files or environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "kanvas-s3-secrets-"));
    roots.push(root);
    const accessKeyFile = join(root, "access-key");
    const secretKeyFile = join(root, "secret-key");
    await writeFile(accessKeyFile, "test-access\n", {
      mode: 0o600,
    });
    await writeFile(secretKeyFile, "test-secret\n", {
      mode: 0o600,
    });

    expect(
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_S3_STORAGE_PROFILE_ID: profileId,
          KANVAS_S3_ENDPOINT: "https://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
          KANVAS_S3_ACCESS_KEY_ID_FILE: accessKeyFile,
          KANVAS_S3_SECRET_ACCESS_KEY_FILE: secretKeyFile,
        },
        "production",
      ),
    ).toMatchObject({
      credentials: {
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
      },
    });
    expect(() =>
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_S3_STORAGE_PROFILE_ID: profileId,
          KANVAS_S3_ENDPOINT: "https://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
          KANVAS_S3_ACCESS_KEY_ID: "direct",
          KANVAS_S3_SECRET_ACCESS_KEY: "direct-secret",
        },
        "production",
      ),
    ).not.toThrow();
  });

  it("fails closed on mixed profiles and unacknowledged production HTTP", () => {
    expect(() =>
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_LOCAL_STORAGE_ROOT: "/srv/kanvas/objects",
          KANVAS_S3_STORAGE_PROFILE_ID: profileId,
          KANVAS_S3_ENDPOINT: "https://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
        },
        "production",
      ),
    ).toThrow(/Local settings/u);
    expect(() =>
      loadStorageAdapterConfig(
        {
          KANVAS_STORAGE_KIND: "s3",
          KANVAS_S3_STORAGE_PROFILE_ID: profileId,
          KANVAS_S3_ENDPOINT: "http://objects.example.com",
          KANVAS_S3_REGION: "us-east-1",
          KANVAS_S3_BUCKET: "kanvas-objects",
        },
        "production",
      ),
    ).toThrow(/must use HTTPS/u);
  });
});
