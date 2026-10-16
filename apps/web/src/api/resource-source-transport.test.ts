import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceResourceSource,
  fetchWorkspaceArtTextCatalog,
  fetchWorkspaceFontCatalog,
  searchResourceCatalog,
  fetchResourceSourceTypes,
} from "./transport.js";

describe("resource source transport", () => {
  it("loads trusted Adapter descriptors in Workspace scope", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ sourceTypes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    await expect(
      fetchResourceSourceTypes("workspace-1", fetcher),
    ).resolves.toEqual({
      sourceTypes: [],
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/resource-source-types", {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": "workspace-1",
      },
    });
  });

  it("submits credential material only in the create mutation body", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            replayed: false,
            source: {
              id: "01K00000000000000000000001",
              displayName: "Pexels",
              adapterKind: "pexels.v1",
              adapterVersion: "1.0.0",
              authMode: "api_key",
              endpointOrigin: "https://api.pexels.com",
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
              lifecycleStatus: "draft",
              validationStatus: "not_checked",
              secretConfigured: true,
              version: 1,
              createdAt: "2026-08-27T04:00:00.000Z",
              updatedAt: "2026-08-27T04:00:00.000Z",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    });

    await createWorkspaceResourceSource(
      { csrfToken: "csrf", workspaceId: "workspace-1" },
      {
        displayName: "Pexels",
        adapterKind: "pexels.v1",
        adapterVersion: "1.0.0",
        authMode: "api_key",
        endpointOrigin: "https://api.pexels.com",
        configuration: {},
        credentialMaterial: "one-time-key",
        licensePolicy: {
          requireCommercialUse: true,
          allowAttribution: true,
          allowShareAlike: false,
          allowStandaloneRedistributionRestriction: true,
          allowUnknownModelRelease: true,
          allowUnknownPropertyRelease: true,
          allowedLicenseIds: [],
        },
      },
      "create-1",
      fetcher,
    );

    const init = fetcher.mock.calls[0]?.[1];
    if (!init) {
      throw new Error("Expected request options.");
    }
    expect(init.headers).toMatchObject({
      "idempotency-key": "create-1",
      "x-kanvas-csrf": "csrf",
    });
    if (typeof init.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    expect(JSON.parse(init.body)).toMatchObject({
      credentialMaterial: "one-time-key",
    });
  });

  it("searches one explicit published source without exposing Adapter details", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sourceId: "01K00000000000000000000001",
            sourceRevisionId: "01K00000000000000000000002",
            candidates: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    await searchResourceCatalog(
      "workspace-1",
      {
        sourceId: "01K00000000000000000000001",
        query: "mountain",
        limit: 24,
      },
      fetcher,
    );

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/resource-catalog/search?sourceId=01K00000000000000000000001&q=mountain&limit=24",
    );
  });

  it.each([
    [
      fetchWorkspaceFontCatalog,
      "/api/v1/resource-catalog/fonts",
      { fonts: [] },
    ],
    [
      fetchWorkspaceArtTextCatalog,
      "/api/v1/resource-catalog/art-text",
      { presets: [] },
    ],
  ] as const)(
    "loads internalized catalog entries",
    async (load, path, body) => {
      const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      await expect(load("workspace-1", fetcher)).resolves.toEqual(body);
      expect(fetcher).toHaveBeenCalledWith(path, {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-kanvas-workspace-id": "workspace-1",
        },
      });
    },
  );
});
