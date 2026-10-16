import { describe, expect, it } from "vitest";
import {
  loadStorageAdapterConfig,
  storageAdapterPublicConfiguration,
} from "../src/storage-runtime-config.js";

const environment = {
  KANVAS_STORAGE_KIND: "oss",
  KANVAS_OSS_STORAGE_PROFILE_ID: "01K00000000000000000000029",
  KANVAS_OSS_ENDPOINT: "https://objects.example",
  KANVAS_OSS_REGION: "oss-cn-test",
  KANVAS_OSS_BUCKET: "test-bucket",
  KANVAS_OSS_KEY_PREFIX: "kanvas-test/",
  KANVAS_OSS_ACCESS_KEY_ID: "private-test-key",
  KANVAS_OSS_ACCESS_KEY_SECRET: "private-test-secret",
};

describe("native OSS deployment configuration", () => {
  it("selects OSS explicitly without exposing credentials in profile facts", () => {
    const config = loadStorageAdapterConfig(environment, "production");
    expect(config?.kind).toBe("oss");
    if (!config) throw new Error("Missing config");
    const publicConfiguration = JSON.stringify(
      storageAdapterPublicConfiguration(config),
    );
    expect(publicConfiguration).toContain("kanvas-test/");
    expect(publicConfiguration).not.toContain("private-test");
  });
  it("rejects mixed providers and orphaned OSS variables", () => {
    expect(() =>
      loadStorageAdapterConfig(
        { ...environment, KANVAS_S3_BUCKET: "other" },
        "production",
      ),
    ).toThrow(/combined/u);
    expect(() =>
      loadStorageAdapterConfig(
        { ...environment, KANVAS_STORAGE_KIND: "s3" },
        "production",
      ),
    ).toThrow(/requires/u);
  });
  it("rejects unsafe prefixes and credential-bearing endpoints without echoing secrets", () => {
    for (const prefix of ["", "../", "/root/", "kanvas-test"]) {
      expect(() =>
        loadStorageAdapterConfig(
          { ...environment, KANVAS_OSS_KEY_PREFIX: prefix },
          "production",
        ),
      ).toThrow();
    }
    expect(() =>
      loadStorageAdapterConfig(
        {
          ...environment,
          KANVAS_OSS_ENDPOINT: "https://user:secret@objects.example",
        },
        "production",
      ),
    ).toThrow(/Invalid OSS/u);
  });
});
