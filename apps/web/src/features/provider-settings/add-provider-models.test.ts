import type { ProviderModelCatalog } from "@kanvas/contracts/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as transport from "../../api/transport.js";
import {
  addProviderModels,
  canAddProviderModel,
} from "./add-provider-models.js";

vi.mock("../../api/transport.js", () => ({
  createWorkspaceModel: vi.fn(),
  fetchWorkspaceModels: vi.fn(),
  fetchWorkspaceProviderModelCatalog: vi.fn(),
  importWorkspaceProviderModels: vi.fn(),
  mapWorkspaceProviderModel: vi.fn(),
}));
const context = { workspaceId: "workspace", csrfToken: "csrf" };
function entry(id: string): ProviderModelCatalog["models"][number] {
  return {
    upstreamModelId: id,
    displayName: id,
    inputModalities: ["text"],
    outputModalities: ["text"],
    completeness: "partial",
    suggestedCanonicalSlug: id,
    suggestionSource: "provider",
  };
}
const selected = ["first", "second"].map((id) => ({
  upstreamModelId: id,
  canonicalSlug: id,
}));
const canonical = (id: string) => ({
  id: `canonical-${id}`,
  slug: id,
  lifecycle: "draft" as const,
  sourceKind: "provider" as const,
  version: 1,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  providers: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(transport.fetchWorkspaceProviderModelCatalog).mockResolvedValue({
    models: [entry("first"), entry("second")],
  });
  vi.mocked(transport.fetchWorkspaceModels).mockResolvedValue({ models: [] });
  vi.mocked(transport.createWorkspaceModel).mockImplementation((_ctx, body) =>
    Promise.resolve({ model: canonical(body.slug), result: "created" }),
  );
  vi.mocked(transport.importWorkspaceProviderModels).mockImplementation(
    (_ctx, _id, body) =>
      Promise.resolve({
        models: body.upstreamModelIds.map((id) => ({
          id: `provider-${id}`,
          upstreamModelId: id,
          lifecycle: "discovered",
          version: 1,
        })),
        created: body.upstreamModelIds.length,
        refreshed: 0,
      }),
  );
  vi.mocked(transport.mapWorkspaceProviderModel).mockResolvedValue({
    model: canonical("first"),
    result: "mapped",
  });
});

describe("adding models to an existing provider", () => {
  it("imports and maps selected models without publishing them", async () => {
    await addProviderModels(context, "provider", selected);
    expect(transport.importWorkspaceProviderModels).toHaveBeenCalledWith(
      context,
      "provider",
      { upstreamModelIds: ["first", "second"] },
    );
    expect(transport.mapWorkspaceProviderModel).toHaveBeenNthCalledWith(
      2,
      context,
      "provider",
      "provider-second",
      {
        expectedVersion: 1,
        canonicalModelId: "canonical-second",
        mappingSource: "provider",
        mappingConfidence: "suggested",
      },
    );
  });
  it("reuses an existing canonical model for another supplier", async () => {
    vi.mocked(transport.fetchWorkspaceModels).mockResolvedValue({
      models: [canonical("first")],
    });
    await addProviderModels(context, "provider", selected.slice(0, 1));
    expect(transport.createWorkspaceModel).not.toHaveBeenCalled();
    expect(transport.mapWorkspaceProviderModel).toHaveBeenCalledWith(
      context,
      "provider",
      "provider-first",
      expect.objectContaining({ canonicalModelId: "canonical-first" }),
    );
  });
  it("resumes after a partial failure and never remaps an already added model", async () => {
    vi.mocked(transport.mapWorkspaceProviderModel)
      .mockResolvedValueOnce({ model: canonical("first"), result: "mapped" })
      .mockRejectedValueOnce(new Error("network"));
    await expect(
      addProviderModels(context, "provider", selected),
    ).rejects.toThrow("network");
    vi.mocked(transport.fetchWorkspaceProviderModelCatalog).mockResolvedValue({
      models: [
        {
          ...entry("first"),
          imported: {
            id: "provider-first",
            canonicalModelId: "canonical-first",
            lifecycle: "mapped",
            version: 2,
          },
        },
        {
          ...entry("second"),
          imported: {
            id: "provider-second",
            lifecycle: "discovered",
            version: 1,
          },
        },
      ],
    });
    vi.mocked(transport.fetchWorkspaceModels).mockResolvedValue({
      models: [canonical("first"), canonical("second")],
    });
    await addProviderModels(context, "provider", selected);
    expect(transport.importWorkspaceProviderModels).toHaveBeenLastCalledWith(
      context,
      "provider",
      { upstreamModelIds: ["second"] },
    );
    expect(
      vi
        .mocked(transport.mapWorkspaceProviderModel)
        .mock.calls.filter((call) => call[2] === "provider-first"),
    ).toHaveLength(1);
    expect(transport.createWorkspaceModel).toHaveBeenCalledTimes(2);
  });
  it("does not remap a model mapped concurrently before import completes", async () => {
    vi.mocked(transport.importWorkspaceProviderModels).mockResolvedValue({
      models: [
        {
          id: "provider-first",
          upstreamModelId: "first",
          lifecycle: "mapped",
          version: 3,
        },
      ],
      created: 0,
      refreshed: 1,
    });
    await addProviderModels(context, "provider", selected.slice(0, 1));
    expect(transport.mapWorkspaceProviderModel).not.toHaveBeenCalled();
    expect(transport.createWorkspaceModel).not.toHaveBeenCalled();
  });
  it("validates the complete selection before writing anything", async () => {
    await expect(
      addProviderModels(context, "provider", [
        selected[0]!,
        { upstreamModelId: "second", canonicalSlug: "invalid name" },
      ]),
    ).rejects.toMatchObject({ code: "identifier" });
    expect(transport.importWorkspaceProviderModels).not.toHaveBeenCalled();
  });
  it("rejects models absent from the current catalog", async () => {
    await expect(
      addProviderModels(context, "provider", [
        { upstreamModelId: "missing", canonicalSlug: "missing" },
      ]),
    ).rejects.toMatchObject({ code: "missing" });
    expect(transport.importWorkspaceProviderModels).not.toHaveBeenCalled();
  });
  it("keeps disabled models out of the append workflow", async () => {
    const disabled = {
      ...entry("first"),
      imported: {
        id: "provider-first",
        canonicalModelId: "canonical-first",
        lifecycle: "disabled" as const,
        version: 3,
      },
    };
    expect(canAddProviderModel(disabled)).toBe(false);
    vi.mocked(transport.fetchWorkspaceProviderModelCatalog).mockResolvedValue({
      models: [disabled],
    });
    await expect(
      addProviderModels(context, "provider", selected.slice(0, 1)),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(transport.importWorkspaceProviderModels).not.toHaveBeenCalled();
  });
});
