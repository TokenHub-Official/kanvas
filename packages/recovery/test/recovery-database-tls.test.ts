import { createPool } from "mysql2/promise";
import { expect, it, vi } from "vitest";

import { loadCommandRuntime } from "../src/cli/support.js";

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => {
    throw new Error("connection boundary reached");
  }),
}));

it("preserves required database TLS at the backup/recovery connection boundary", async () => {
  await expect(
    loadCommandRuntime({
      KANVAS_INSTANCE_ID: "tls-test",
      KANVAS_DEPLOYMENT_ID: "tls-test",
      KANVAS_CONFIG_MANIFEST_DIGEST: `sha256:${"a".repeat(64)}`,
      KANVAS_RECOVERY_AUTHENTICATION_REF_HASH: `sha256:${"b".repeat(64)}`,
      KANVAS_RECOVERY_OPERATOR_ID: "test-operator",
      KANVAS_DATABASE_URL: "mysql://test:test@db.example.test/kanvas?ssl=true",
    }),
  ).rejects.toThrow("connection boundary reached");
  expect(createPool).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "db.example.test",
      ssl: { rejectUnauthorized: true, verifyIdentity: true },
    }),
  );
});
