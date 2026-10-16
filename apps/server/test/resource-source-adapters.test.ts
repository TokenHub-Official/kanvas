import { describe, expect, it } from "vitest";

import {
  ResourceSourceAdapterError,
  listResourceSourceAdapterTypes,
  resourceSourceAdapterCapabilities,
  searchResourceSourceAdapter,
  validateResourceSourceAdapter,
} from "../src/resource-sources/resource-source-adapters.js";

describe("resource source adapters", () => {
  const searchBase = {
    sourceInstanceId: "01K00000000000000000000001",
    sourceRevisionId: "01K00000000000000000000002",
    configuration: {},
    licensePolicy: {
      requireCommercialUse: true,
      allowAttribution: true,
      allowShareAlike: false,
      allowStandaloneRedistributionRestriction: true,
      allowUnknownModelRelease: true,
      allowUnknownPropertyRelease: true,
      allowedLicenseIds: [] as string[],
    },
    query: "mountain",
    limit: 12,
    now: new Date("2026-08-27T06:00:00.000Z"),
  };

  it("projects the trusted Adapter catalog consumed by settings", () => {
    const sourceTypes = listResourceSourceAdapterTypes();
    expect(
      sourceTypes.map((sourceType) => ({
        adapterKind: sourceType.adapterKind,
        authModes: sourceType.authModes,
      })),
    ).toEqual([
      { adapterKind: "openverse.v1", authModes: ["none"] },
      { adapterKind: "pexels.v1", authModes: ["api_key"] },
      { adapterKind: "pixabay.v1", authModes: ["api_key"] },
      { adapterKind: "iconify.v1", authModes: ["none"] },
      { adapterKind: "fontsource.v1", authModes: ["none"] },
      { adapterKind: "google-fonts.v1", authModes: ["api_key"] },
      { adapterKind: "art-text-registry.v1", authModes: ["none"] },
    ]);
    expect(
      sourceTypes.every((sourceType) =>
        sourceType.iconPath.startsWith("/resource-source-icons/"),
      ),
    ).toBe(true);
    expect(
      sourceTypes
        .find((sourceType) => sourceType.adapterKind === "fontsource.v1")
        ?.configurationFields.map((field) => field.key),
    ).toEqual(["preferredSubsets"]);
  });

  it("validates Openverse through the bounded requester", async () => {
    const requests: unknown[] = [];
    const result = await validateResourceSourceAdapter({
      adapterKind: "openverse.v1",
      endpointOrigin: "https://api.openverse.org",
      request: (request) => {
        requests.push(request);
        return Promise.resolve({ statusCode: 200, body: { results: [] } });
      },
    });

    expect(result.capabilities).toEqual(["image.search", "image.import"]);
    expect(result.validationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(requests).toEqual([
      {
        baseUrl: "https://api.openverse.org",
        path: "/v1/images/?q=landscape&page_size=1",
        headers: {},
      },
    ]);
  });

  it("keeps platform credential conventions inside each Adapter", async () => {
    const requests: Array<{
      readonly headers: Readonly<Record<string, string>>;
    }> = [];
    await validateResourceSourceAdapter({
      adapterKind: "pexels.v1",
      endpointOrigin: "https://api.pexels.com",
      material: Buffer.from("pexels-key"),
      request: (request) => {
        requests.push(request);
        return Promise.resolve({ statusCode: 200, body: { photos: [] } });
      },
    });

    expect(requests[0]?.headers).toEqual({ authorization: "pexels-key" });
  });

  it("rejects unavailable adapters and invalid catalog shapes", async () => {
    expect(() => resourceSourceAdapterCapabilities("unknown.v1")).toThrow(
      ResourceSourceAdapterError,
    );
    await expect(
      validateResourceSourceAdapter({
        adapterKind: "fontsource.v1",
        endpointOrigin: "https://api.fontsource.org",
        request: () => Promise.resolve({ statusCode: 200, body: {} }),
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("normalizes Openverse results and enforces the Workspace license policy", async () => {
    let searchPath = "";
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      limit: 24,
      adapterKind: "openverse.v1",
      endpointOrigin: "https://api.openverse.org",
      licensePolicy: {
        ...searchBase.licensePolicy,
        allowedLicenseIds: ["CC0-1.0"],
      },
      request: (request) => {
        searchPath = request.path;
        return Promise.resolve({
          statusCode: 200,
          body: {
            results: [
              {
                id: "cc0-image",
                title: "Mountain",
                thumbnail: "https://api.openverse.org/thumb.jpg",
                url: "https://images.example/mountain.jpg",
                foreign_landing_url: "https://example.com/mountain",
                license: "cc0",
                license_url:
                  "https://creativecommons.org/publicdomain/zero/1.0/",
                width: 1200,
                height: 800,
              },
              {
                id: "attributed-image",
                title: "Other mountain",
                thumbnail: "https://api.openverse.org/other.jpg",
                url: "https://images.example/other.jpg",
                foreign_landing_url: "https://example.com/other",
                license: "by",
                license_version: "4.0",
                license_url: "https://creativecommons.org/licenses/by/4.0/",
              },
            ],
          },
        });
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(searchPath).toContain("license=cc0");
    expect(searchPath).toContain("page_size=20");
    expect(result.candidates[0]).toMatchObject({
      externalId: "cc0-image",
      kind: "image",
      license: { licenseId: "CC0-1.0", commercialUseAllowed: true },
    });
  });

  it("keeps Pexels platform credit obligations separate from its content license", async () => {
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "pexels.v1",
      endpointOrigin: "https://api.pexels.com",
      material: Buffer.from("key"),
      request: () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            photos: [
              {
                id: 42,
                width: 1200,
                height: 800,
                url: "https://www.pexels.com/photo/42/",
                photographer: "Artist",
                alt: "Landscape",
                src: {
                  medium: "https://images.pexels.com/preview.jpg",
                  original: "https://images.pexels.com/original.jpg",
                },
              },
            ],
          },
        }),
    });

    expect(result.candidates[0]).toMatchObject({
      license: { attributionRequired: false },
      providerObligations: { displayCreditRequired: true },
    });
  });

  it("normalizes Pixabay restrictions and Iconify collection licenses", async () => {
    const pixabay = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "pixabay.v1",
      endpointOrigin: "https://pixabay.com",
      material: Buffer.from("key"),
      request: () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            hits: [
              {
                id: 7,
                pageURL: "https://pixabay.com/photos/7/",
                webformatURL: "https://cdn.pixabay.com/preview.jpg",
                largeImageURL: "https://cdn.pixabay.com/original.jpg",
                webformatWidth: 640,
                webformatHeight: 480,
                imageWidth: 1600,
                imageHeight: 1200,
                user: "Contributor",
                tags: "mountain, landscape",
              },
            ],
          },
        }),
    });
    expect(pixabay.candidates[0]).toMatchObject({
      kind: "image",
      license: { standaloneRedistributionAllowed: false },
      providerObligations: { coreReplicationRestricted: true },
    });

    const iconify = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "iconify.v1",
      endpointOrigin: "https://api.iconify.design",
      request: () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            icons: ["lucide:mountain"],
            collections: {
              lucide: {
                name: "Lucide",
                width: 24,
                height: 24,
                license: {
                  spdx: "ISC",
                  url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
                },
              },
            },
          },
        }),
    });
    expect(iconify.candidates[0]).toMatchObject({
      kind: "vector",
      externalId: "lucide:mountain",
      license: { licenseId: "ISC" },
      original: { mediaType: "image/svg+xml" },
    });
  });

  it("pins Google Fonts files only after resolving the exact open-source license", async () => {
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "google-fonts.v1",
      query: "inter",
      endpointOrigin: "https://www.googleapis.com",
      material: Buffer.from("key"),
      request: (request) => {
        if (request.baseUrl === "https://api.github.com") {
          return Promise.resolve({
            statusCode: 200,
            body: {
              html_url:
                "https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt",
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          body: {
            items: [
              {
                family: "Inter",
                version: "v20",
                category: "sans-serif",
                subsets: ["latin", "latin-ext"],
                files: {
                  regular:
                    "http://fonts.gstatic.com/s/inter/v20/inter-regular.ttf",
                  "700": "https://fonts.gstatic.com/s/inter/v20/inter-700.ttf",
                },
              },
            ],
          },
        });
      },
    });

    expect(result.candidates[0]).toMatchObject({
      kind: "font",
      family: "Inter",
      upstreamVersion: "v20",
      license: { licenseId: "OFL-1.1", embeddingAllowed: true },
    });
    if (result.candidates[0]?.kind !== "font") {
      throw new Error("Expected a font candidate.");
    }
    expect(result.candidates[0].fileVariants).toEqual(
      expect.arrayContaining([
        {
          url: "https://fonts.gstatic.com/s/inter/v20/inter-regular.ttf",
          format: "ttf",
          weight: 400,
          style: "normal",
          subset: "latin",
          pinned: true,
        },
        {
          url: "https://fonts.gstatic.com/s/inter/v20/inter-700.ttf",
          format: "ttf",
          weight: 700,
          style: "normal",
          subset: "latin",
          pinned: true,
        },
      ]),
    );
  });

  it("replaces Fontsource floating CDN links with the exact package version", async () => {
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "fontsource.v1",
      query: "inter",
      endpointOrigin: "https://api.fontsource.org",
      configuration: { preferredSubsets: ["latin"] },
      request: (request) => {
        if (request.baseUrl === "https://registry.npmjs.org") {
          return Promise.resolve({
            statusCode: 200,
            body: { version: "5.2.7", license: "OFL-1.1" },
          });
        }
        if (request.path === "/v1/fonts/inter") {
          return Promise.resolve({
            statusCode: 200,
            body: {
              family: "Inter",
              category: "sans-serif",
              subsets: ["latin"],
              defSubset: "latin",
              variants: {
                400: {
                  normal: {
                    korean: {
                      url: {
                        ttf: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/korean-400-normal.ttf",
                      },
                    },
                    latin: {
                      url: {
                        ttf: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf",
                      },
                    },
                    "chinese-simplified": {
                      url: {
                        ttf: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/chinese-simplified-400-normal.ttf",
                      },
                    },
                  },
                },
              },
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          body: [
            {
              id: "inter",
              family: "Inter",
            },
          ],
        });
      },
    });

    expect(result.candidates[0]).toMatchObject({
      family: "Inter",
      upstreamVersion: "5.2.7",
      fileVariants: [
        {
          url: "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.7/latin-400-normal.ttf",
          pinned: true,
        },
      ],
    });
  });

  it("keeps usable Fontsource results when one detail request fails", async () => {
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "fontsource.v1",
      query: "",
      endpointOrigin: "https://api.fontsource.org",
      request: (request) => {
        if (request.baseUrl === "https://registry.npmjs.org") {
          return Promise.resolve({
            statusCode: 200,
            body: { version: "5.2.7", license: "OFL-1.1" },
          });
        }
        if (request.path === "/v1/fonts/broken") {
          return Promise.reject(new Error("detail unavailable"));
        }
        if (request.path === "/v1/fonts/inter") {
          return Promise.resolve({
            statusCode: 200,
            body: {
              family: "Inter",
              category: "sans-serif",
              subsets: ["latin"],
              variants: {
                400: {
                  normal: {
                    latin: {
                      url: {
                        ttf: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf",
                      },
                    },
                  },
                },
              },
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          body: [
            { id: "broken", family: "Broken" },
            { id: "inter", family: "Inter" },
          ],
        });
      },
    });

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "Inter",
    ]);
    expect(result.candidates[0]).toMatchObject({
      fileVariants: [expect.objectContaining({ subset: "latin" })],
    });
  });

  it("imports only schema-valid editable Art Text manifests from the configured origin", async () => {
    const manifestDigest = `sha256:${"c".repeat(64)}`;
    const result = await searchResourceSourceAdapter({
      ...searchBase,
      adapterKind: "art-text-registry.v1",
      query: "comic",
      endpointOrigin: "https://styles.example.com",
      request: (request) => {
        if (request.path === "/presets/comic-pop.json") {
          return Promise.resolve({
            statusCode: 200,
            body: {
              schemaVersion: 1,
              id: "comic-pop",
              revision: manifestDigest,
              labels: { "en-US": "Comic Pop" },
              fontRequirements: {
                requiredScripts: ["latin"],
                fallbackCategory: "display",
              },
              fill: { kind: "solid", color: "#ff4f9a" },
              effects: [{ kind: "outline", color: "#151515", width: 7 }],
              letterSpacing: 2,
              lineHeight: 1.1,
              alignment: "center",
              editable: {
                text: true,
                font: true,
                colorSlots: ["primary", "outline"],
              },
              license: {
                licenseId: "CC0-1.0",
                licenseUrl:
                  "https://creativecommons.org/publicdomain/zero/1.0/",
                commercialUseAllowed: true,
                modificationAllowed: true,
                attributionRequired: false,
                shareAlikeRequired: false,
                standaloneRedistributionAllowed: true,
                modelReleaseStatus: "not_applicable",
                propertyReleaseStatus: "not_applicable",
                trademarkRisk: "none_declared",
                capturedAt: "2026-08-27T06:00:00.000Z",
                termsDigest: `sha256:${"d".repeat(64)}`,
              },
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          body: {
            schemaVersion: 1,
            presets: [
              {
                id: "comic-pop",
                revision: manifestDigest,
                manifestUrl:
                  "https://styles.example.com/presets/comic-pop.json",
                labels: { "en-US": "Comic Pop" },
              },
            ],
          },
        });
      },
    });

    expect(result.candidates[0]).toMatchObject({
      kind: "art_text",
      externalId: "comic-pop",
      manifest: {
        editable: { text: true },
        effects: [{ kind: "outline" }],
      },
    });
  });
});
