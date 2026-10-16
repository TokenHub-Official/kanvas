import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfigurationRevision } from "@kanvas/contracts/api";
import { createRuntimeConfigurationReader } from "../src/runtime/runtime-configuration-reader.js";
const fallback = {
  maximumModelCalls: 16,
  maximumToolCalls: 24,
  timeoutSeconds: 600,
};
const deployment = {
  enabled: true,
  allowedOrigins: ["https://legacy.example"],
};
const context = { workspaceId: "workspace", providerEndpointId: "endpoint" };
function revision(activated = true): RuntimeConfigurationRevision {
  return {
    version: 7,
    document: {
      activated,
      agent: {
        maximumModelCalls: 50,
        maximumToolCalls: 100,
        timeoutSeconds: 600,
      },
      downloads: {
        defaults: { enabled: true, allowedOrigins: ["https://new.example"] },
        providers: [],
      },
    },
    reason: "test",
    publishedBy: "admin",
    publishedAt: new Date().toISOString(),
    restoredFromVersion: null,
  };
}
describe("shared runtime configuration reader", () => {
  it.each([null, revision(false)])(
    "uses legacy sources only when not activated",
    async (value) => {
      const snapshot = await createRuntimeConfigurationReader(() =>
        Promise.resolve(value),
      ).read();
      expect(snapshot.agentLimits(fallback)).toEqual({
        value: fallback,
        source: "profile",
        version: null,
      });
      expect(snapshot.resultDownloads(context, deployment)).toEqual({
        value: deployment,
        source: "environment",
        version: null,
      });
      expect(snapshot.downloadSource).toBe("environment");
    },
  );
  it("automatically replaces legacy values with one shared version after activation", async () => {
    const snapshot = await createRuntimeConfigurationReader(() =>
      Promise.resolve(revision()),
    ).read();
    expect(snapshot.agentLimits(fallback)).toMatchObject({
      source: "instance",
      version: 7,
      value: { maximumModelCalls: 50 },
    });
    expect(snapshot.resultDownloads(context, deployment)).toEqual({
      source: "instance",
      version: 7,
      value: { enabled: true, allowedOrigins: ["https://new.example"] },
    });
    expect(snapshot.downloadSource).toBe("instance");
  });
  it("keeps service scope and deployment emergency disable independent", async () => {
    const config = revision();
    config.document.downloads.providers.push({
      ...context,
      rule: { enabled: true, allowedOrigins: [] },
    });
    const snapshot = await createRuntimeConfigurationReader(() =>
      Promise.resolve(config),
    ).read();
    expect(
      snapshot.resultDownloads(context, deployment).value.allowedOrigins,
    ).toEqual([]);
    expect(
      snapshot.resultDownloads({ ...context, workspaceId: "other" }, deployment)
        .value.allowedOrigins,
    ).toEqual(["https://new.example"]);
    expect(
      snapshot.resultDownloads(context, { ...deployment, enabled: false }).value
        .enabled,
    ).toBe(false);
  });
  it("does not fall back after an unavailable or corrupt read", async () => {
    const load = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    await expect(
      createRuntimeConfigurationReader(load).read(),
    ).rejects.toMatchObject({ code: "runtime_configuration.unavailable" });
    expect(load).toHaveBeenCalledOnce();
  });
  it("pins immutable values to the read while later readers see the new revision", async () => {
    const config = revision();
    const load = vi.fn().mockImplementation(() => Promise.resolve(config));
    const reader = createRuntimeConfigurationReader(load);
    const first = await reader.read();
    config.document.agent.maximumModelCalls = 40;
    config.document.downloads.defaults.allowedOrigins = null;
    const second = await reader.read();
    expect(first.agentLimits(fallback).value.maximumModelCalls).toBe(50);
    expect(second.agentLimits(fallback).value.maximumModelCalls).toBe(40);
    const result = first.resultDownloads(context, deployment);
    expect(result.value.allowedOrigins).toEqual(["https://new.example"]);
    expect(Object.isFrozen(result.value.allowedOrigins)).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
