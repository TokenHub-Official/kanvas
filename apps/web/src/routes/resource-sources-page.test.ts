import type {
  ResourceSourceSummary,
  ResourceSourceType,
} from "@kanvas/contracts/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSource = vi.hoisted(() => vi.fn());
const validateSource = vi.hoisted(() => vi.fn());
const publishSource = vi.hoisted(() => vi.fn());
const disableSource = vi.hoisted(() => vi.fn());

vi.mock("../api/transport.js", () => ({
  createWorkspaceResourceSource: createSource,
  disableWorkspaceResourceSource: disableSource,
  fetchResourceSourceTypes: vi.fn(),
  fetchWorkspaceResourceSources: vi.fn(),
  publishWorkspaceResourceSource: publishSource,
  rotateWorkspaceResourceSourceCredential: vi.fn(),
  validateWorkspaceResourceSource: validateSource,
}));

import {
  resourceSourceConfigurationValueMissing,
  resourceSourceRequiresConfiguration,
  runResourceSourceEnableFlow,
} from "./resource-sources-page.js";

const sourceType = {
  adapterKind: "openverse.v1",
  adapterVersion: "1.0.0",
  displayName: "Openverse",
  description: "Open-licensed and public-domain images",
  iconPath: "/resource-source-icons/openverse.svg",
  resourceKinds: ["image"],
  capabilities: ["image.search", "image.import"],
  authModes: ["none"],
  defaultEndpointOrigin: "https://api.openverse.org",
  configurationFields: [],
} as const satisfies ResourceSourceType;

function source(
  lifecycleStatus: ResourceSourceSummary["lifecycleStatus"],
  version: number,
): ResourceSourceSummary {
  return {
    id: "01K00000000000000000000001",
    displayName: "Openverse",
    adapterKind: sourceType.adapterKind,
    adapterVersion: sourceType.adapterVersion,
    authMode: "none",
    endpointOrigin: sourceType.defaultEndpointOrigin,
    configuration: {},
    configurationDigest: `sha256:${"a".repeat(64)}`,
    licensePolicy: {
      requireCommercialUse: true,
      allowAttribution: true,
      allowShareAlike: false,
      allowStandaloneRedistributionRestriction: true,
      allowUnknownModelRelease: true,
      allowUnknownPropertyRelease: true,
      allowedLicenseIds: [],
    },
    lifecycleStatus,
    validationStatus:
      lifecycleStatus === "ready" || lifecycleStatus === "published"
        ? "passed"
        : "not_checked",
    secretConfigured: true,
    version,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("resource source one-click enable flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens configuration only while a required source is incomplete", () => {
    const pexels = {
      ...sourceType,
      adapterKind: "pexels.v1",
      authModes: ["api_key"],
    } as const satisfies ResourceSourceType;

    expect(
      resourceSourceRequiresConfiguration({
        key: pexels.adapterKind,
        sourceType: pexels,
      }),
    ).toBe(true);
    expect(
      resourceSourceRequiresConfiguration({
        key: pexels.adapterKind,
        source: source("disabled", 4),
        sourceType: pexels,
      }),
    ).toBe(false);
    expect(
      resourceSourceRequiresConfiguration({
        key: pexels.adapterKind,
        source: source("failed", 4),
        sourceType: pexels,
      }),
    ).toBe(true);
  });

  it("marks only empty required configuration values as missing", () => {
    const field = {
      key: "collection",
      label: "Collection",
      inputKind: "string_list",
      required: true,
    } as const satisfies ResourceSourceType["configurationFields"][number];

    expect(resourceSourceConfigurationValueMissing(field, [])).toBe(true);
    expect(resourceSourceConfigurationValueMissing(field, ["photos"])).toBe(
      false,
    );
  });

  it("creates, checks, and enables an unconfigured source in one action", async () => {
    createSource.mockResolvedValue({ source: source("draft", 1) });
    validateSource.mockResolvedValue({ source: source("ready", 2) });
    publishSource.mockResolvedValue({ source: source("published", 3) });

    await expect(
      runResourceSourceEnableFlow(
        { csrfToken: "csrf", workspaceId: "workspace-1" },
        { sourceType },
      ),
    ).resolves.toMatchObject({ lifecycleStatus: "published", version: 3 });

    expect(createSource).toHaveBeenCalledOnce();
    expect(validateSource).toHaveBeenCalledOnce();
    expect(publishSource).toHaveBeenCalledOnce();
    expect(createSource.mock.invocationCallOrder[0]).toBeLessThan(
      validateSource.mock.invocationCallOrder[0]!,
    );
    expect(validateSource.mock.invocationCallOrder[0]).toBeLessThan(
      publishSource.mock.invocationCallOrder[0]!,
    );
  });

  it("rechecks and republishes a disabled source without recreating it", async () => {
    validateSource.mockResolvedValue({ source: source("ready", 5) });
    publishSource.mockResolvedValue({ source: source("published", 6) });

    await runResourceSourceEnableFlow(
      { csrfToken: "csrf", workspaceId: "workspace-1" },
      { sourceType, source: source("disabled", 4) },
    );

    expect(createSource).not.toHaveBeenCalled();
    expect(validateSource).toHaveBeenCalledWith(
      expect.anything(),
      "01K00000000000000000000001",
      { expectedVersion: 4 },
      expect.any(String),
    );
    expect(publishSource).toHaveBeenCalledOnce();
  });

  it("does not publish when the connection check fails", async () => {
    createSource.mockResolvedValue({ source: source("draft", 1) });
    validateSource.mockRejectedValue(new Error("connection failed"));

    await expect(
      runResourceSourceEnableFlow(
        { csrfToken: "csrf", workspaceId: "workspace-1" },
        { sourceType },
      ),
    ).rejects.toThrow("connection failed");
    expect(publishSource).not.toHaveBeenCalled();
  });
});
