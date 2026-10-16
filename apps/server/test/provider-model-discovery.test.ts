import { readFileSync } from "node:fs";
import type {
  ProviderModelCapabilityKey,
  ProviderModelOperationDefinition,
  ProviderModelOperations,
} from "@kanvas/contracts/provider-model";
import { describe, expect, it, vi } from "vitest";

import { discoverProviderModelCatalog } from "../src/provider/provider-model-discovery.js";
import type {
  ProviderModelDiscoveryError,
  ProviderModelDiscoveryPreset,
} from "../src/provider/provider-model-discovery.js";
import type { ProviderProbeRequester } from "../src/provider/provider-setting-probe.js";

const observedAt = new Date("2026-08-12T07:00:00.000Z");
const providerModelOperationKeys = [
  "text.generate",
  "image.generate",
  "image.edit",
] as const satisfies readonly ProviderModelCapabilityKey[];

function definedProviderModelOperations(
  operations: ProviderModelOperations,
): readonly (readonly [
  ProviderModelCapabilityKey,
  ProviderModelOperationDefinition,
])[] {
  const defined: Array<
    readonly [ProviderModelCapabilityKey, ProviderModelOperationDefinition]
  > = [];
  for (const operation of providerModelOperationKeys) {
    const definition = operations[operation];
    if (definition) defined.push([operation, definition]);
  }
  return defined;
}

function options(preset: ProviderModelDiscoveryPreset) {
  return {
    preset,
    baseUrl: `https://${preset}.example.test/v1`,
    apiKey: Buffer.from("test-provider-key"),
    observedAt,
  } as const;
}

describe("Provider model discovery", () => {
  it("discovers and paginates Anthropic models with native authentication", async () => {
    const requester = vi.fn<ProviderProbeRequester>(({ path }) =>
      Promise.resolve({
        statusCode: 200,
        body:
          path === "/models?limit=1000"
            ? {
                data: [
                  {
                    id: "claude-sonnet-4-6",
                    display_name: "Claude Sonnet 4.6",
                  },
                ],
                has_more: true,
                last_id: "claude-sonnet-4-6",
              }
            : {
                data: [
                  {
                    id: "claude-haiku-4-5",
                    display_name: "Claude Haiku 4.5",
                  },
                ],
                has_more: false,
                last_id: "claude-haiku-4-5",
              },
      }),
    );

    const catalog = await discoverProviderModelCatalog(
      options("anthropic"),
      requester,
    );

    expect(requester.mock.calls.map(([request]) => request.path)).toEqual([
      "/models?limit=1000",
      "/models?limit=1000&after_id=claude-sonnet-4-6",
    ]);
    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "test-provider-key",
        },
      }),
    );
    expect(catalog).toMatchObject({
      providerPreset: "anthropic",
      discoveryMethod: "anthropic.models.list",
      models: [
        {
          providerModelId: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          completeness: "identity_only",
        },
        {
          providerModelId: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          completeness: "identity_only",
        },
      ],
    });
  });

  it("normalizes OpenRouter typed image descriptors as partial evidence", async () => {
    const requester = vi.fn<ProviderProbeRequester>().mockResolvedValue({
      statusCode: 200,
      body: {
        data: [
          {
            id: "openai/gpt-image-2",
            name: "GPT Image 2",
            description: "Image generation and editing.",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["image"],
            },
            supported_parameters: {
              resolution: {
                type: "enum",
                values: ["1K", "2K", "4K"],
              },
              output_compression: {
                type: "range",
                min: 0,
                max: 100,
              },
              seed: {
                type: "boolean",
              },
              output_format: {
                type: "enum",
                values: ["png", "svg", "jpeg", "tiff"],
              },
              quality: {
                type: "enum",
                values: ["draft", "high"],
              },
            },
          },
        ],
      },
    });

    const catalog = await discoverProviderModelCatalog(
      options("openrouter"),
      requester,
    );

    expect(requester).toHaveBeenCalledWith({
      baseUrl: "https://openrouter.example.test/v1",
      path: "/images/models",
      headers: {
        authorization: "Bearer test-provider-key",
      },
    });
    expect(catalog).toMatchObject({
      providerPreset: "openrouter",
      discoveryMethod: "openrouter.images.models",
      models: [
        {
          providerModelId: "openai/gpt-image-2",
          completeness: "partial",
          inputModalities: ["text", "image"],
          outputModalities: ["image"],
          operations: {
            "image.generate": {
              apiSurfaces: ["images.generations.v1"],
              parameters: [
                {
                  key: "resolution",
                  valueType: "enum",
                  values: ["1K", "2K", "4K"],
                },
                {
                  key: "outputCompression",
                  valueType: "integer",
                  minimum: 0,
                  maximum: 100,
                },
                {
                  key: "seed",
                  valueType: "integer",
                  minimum: 0,
                  maximum: 4_294_967_295,
                },
                {
                  key: "outputFormat",
                  valueType: "enum",
                  values: ["png", "jpeg"],
                },
                {
                  key: "quality",
                  valueType: "enum",
                  values: ["high"],
                },
              ],
            },
          },
        },
      ],
    });
    expect(catalog.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(catalog.models[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "provider_api",
          observedAt: observedAt.toISOString(),
          sourceDigest: catalog.sourceDigest,
          confidence: "high",
          claim: "identity",
        }),
      ]),
    );
    expect(catalog.models[0]?.operations["image.generate"]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "provider_api",
          confidence: "high",
          claim: "supported",
        }),
      ]),
    );
    expect(catalog.models[0]?.operations["image.edit"]).toBeUndefined();
  });

  it("refines selected OpenRouter models to the safe intersection of definitive endpoints", async () => {
    const requester = vi.fn<ProviderProbeRequester>(({ path }) => {
      if (path === "/images/models") {
        return Promise.resolve({
          statusCode: 200,
          body: {
            data: [
              {
                id: "openai/gpt-image-2",
                architecture: {
                  input_modalities: ["text", "image"],
                  output_modalities: ["image"],
                },
                supported_parameters: {
                  resolution: {
                    type: "enum",
                    values: ["1K", "2K", "4K"],
                  },
                  quality: {
                    type: "enum",
                    values: ["low", "medium", "high"],
                  },
                  seed: { type: "boolean" },
                },
              },
            ],
          },
        });
      }
      expect(path).toBe("/images/models/openai/gpt-image-2/endpoints");
      return Promise.resolve({
        statusCode: 200,
        body: {
          id: "openai/gpt-image-2",
          endpoints: [
            {
              provider_slug: "one",
              supported_parameters: {
                resolution: {
                  type: "enum",
                  values: ["1K", "2K", "4K"],
                },
                quality: {
                  type: "enum",
                  values: ["medium", "high"],
                },
                seed: { type: "boolean" },
              },
            },
            {
              provider_slug: "two",
              supported_parameters: {
                resolution: {
                  type: "enum",
                  values: ["1K", "2K"],
                },
                quality: {
                  type: "enum",
                  values: ["low", "medium"],
                },
              },
            },
          ],
        },
      });
    });

    const catalog = await discoverProviderModelCatalog(
      {
        ...options("openrouter"),
        refineModelKeys: ["openai/gpt-image-2"],
      },
      requester,
    );

    expect(requester).toHaveBeenCalledTimes(2);
    expect(catalog.models[0]?.operations["image.generate"]?.parameters).toEqual(
      [
        expect.objectContaining({
          key: "resolution",
          values: ["1K", "2K"],
        }),
        expect.objectContaining({
          key: "quality",
          values: ["medium"],
        }),
      ],
    );
    expect(catalog.models[0]?.operations["image.generate"]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: "openrouter.images.model-endpoints",
          claim: "supported",
        }),
      ]),
    );
  });

  it("keeps OpenAI model discovery identity-only unless a trusted image manifest matches", async () => {
    const catalog = await discoverProviderModelCatalog(options("openai"), () =>
      Promise.resolve({
        statusCode: 200,
        body: {
          object: "list",
          data: [
            {
              id: "gpt-5",
              object: "model",
              owned_by: "openai",
            },
            {
              id: "gpt-image-2",
              object: "model",
              owned_by: "openai",
            },
          ],
        },
      }),
    );

    expect(catalog.models[0]).toMatchObject({
      providerModelId: "gpt-5",
      completeness: "identity_only",
      operations: {},
    });
    expect(catalog.models[1]).toMatchObject({
      providerModelId: "gpt-image-2",
      completeness: "partial",
      operations: {
        "image.generate": {
          apiSurfaces: ["images.generations.v1"],
        },
        "image.edit": {
          apiSurfaces: ["images.edits.v1"],
        },
      },
    });
    expect(
      catalog.models[1]?.operations["image.generate"]?.parameters.map(
        ({ key }) => key,
      ),
    ).toEqual([
      "size",
      "quality",
      "outputFormat",
      "background",
      "outputCompression",
    ]);
    expect(catalog.models[1]?.operations["image.generate"]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "adapter_manifest",
          reference: "kanvas.openai-images.v1",
          confidence: "high",
          claim: "supported",
        }),
      ]),
    );
  });

  it("uses the xAI image catalog and supplements its documented image controls", async () => {
    const catalog = await discoverProviderModelCatalog(
      options("xai"),
      (request) => {
        expect(request.path).toBe("/image-generation-models");
        return Promise.resolve({
          statusCode: 200,
          body: {
            models: [
              {
                id: "grok-imagine-image-2.0",
                input_modalities: ["text", "image"],
                output_modalities: ["image"],
              },
            ],
          },
        });
      },
    );

    expect(catalog.models[0]).toMatchObject({
      completeness: "partial",
      operations: {
        "image.generate": {
          apiSurfaces: ["images.generations.v1"],
        },
        "image.edit": {
          apiSurfaces: ["images.edits.v1"],
        },
      },
    });
    expect(catalog.models[0]?.operations["image.generate"]?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "aspectRatio",
          valueType: "enum",
        }),
        expect.objectContaining({
          key: "resolution",
          values: ["1k", "2k"],
        }),
        expect.objectContaining({
          key: "quality",
          values: ["low", "medium"],
        }),
      ]),
    );
    expect(catalog.models[0]?.operations["image.edit"]?.parameters).toEqual([
      expect.objectContaining({
        key: "aspectRatio",
        valueType: "enum",
      }),
    ]);
  });

  it("paginates Gemini with bounded page tokens and only manifests known image models", async () => {
    const requester = vi.fn<ProviderProbeRequester>(({ path, headers }) => {
      expect(headers).toEqual({
        "x-goog-api-key": "test-provider-key",
      });
      if (path === "/models?pageSize=1000") {
        return Promise.resolve({
          statusCode: 200,
          body: {
            models: [
              {
                name: "models/gemini-3.1-flash",
                displayName: "Gemini 3.1 Flash",
              },
            ],
            nextPageToken: "page two",
          },
        });
      }
      expect(path).toBe("/models?pageSize=1000&pageToken=page%20two");
      return Promise.resolve({
        statusCode: 200,
        body: {
          models: [
            {
              name: "models/gemini-3.1-flash-image-preview",
              displayName: "Gemini 3.1 Flash Image",
            },
          ],
        },
      });
    });

    const catalog = await discoverProviderModelCatalog(
      options("gemini"),
      requester,
    );

    expect(requester).toHaveBeenCalledTimes(2);
    expect(catalog.models[0]).toMatchObject({
      providerModelId: "gemini-3.1-flash",
      completeness: "identity_only",
      operations: {},
    });
    expect(catalog.models[1]).toMatchObject({
      providerModelId: "gemini-3.1-flash-image-preview",
      completeness: "partial",
      operations: {
        "image.generate": {
          apiSurfaces: ["generate-content.image.v1"],
        },
        "image.edit": {
          apiSurfaces: ["generate-content.image.v1"],
        },
      },
    });
    expect(
      catalog.models[1]?.operations["image.generate"]?.parameters.find(
        ({ key }) => key === "resolution",
      ),
    ).toMatchObject({
      values: ["512", "1k", "2k", "4k"],
    });
  });

  it.each([
    [
      "newapi",
      "/models",
      ["aspectRatio", "resolution", "quality", "outputFormat"],
    ],
  ] as const)(
    "keeps unknown %s models identity-only and supplements known generation-task images",
    async (preset, expectedPath, expectedGenerateParameters) => {
      const requester = vi.fn<ProviderProbeRequester>(({ path }) => {
        expect(path).toBe(expectedPath);
        return Promise.resolve({
          statusCode: 200,
          body: {
            data: [{ id: "text-only-model" }, { id: "tokenhub/gpt-image-2" }],
          },
        });
      });

      const catalog = await discoverProviderModelCatalog(
        options(preset),
        requester,
      );

      expect(catalog.models[0]).toMatchObject({
        completeness: "identity_only",
        operations: {},
      });
      expect(catalog.models[1]).toMatchObject({
        completeness: "partial",
        operations: {
          "image.generate": {
            apiSurfaces: ["generation.tasks.v1"],
          },
          "image.edit": {
            apiSurfaces: ["generation.tasks.v1"],
          },
        },
      });
      expect(
        catalog.models[1]?.operations["image.generate"]?.parameters.map(
          ({ key }) => key,
        ),
      ).toEqual(expectedGenerateParameters);
      expect(
        catalog.models[1]?.operations["image.edit"]?.parameters.map(
          ({ key }) => key,
        ),
      ).toEqual(["resolution", "quality", "outputFormat"]);
    },
  );

  it("keeps TokenHub generation and editing contracts separate without inferring model families", async () => {
    const catalog = await discoverProviderModelCatalog(
      options("tokenhub"),
      () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            data: [
              { id: "gpt-image-2" },
              { id: "gpt-image-2-edit" },
              { id: "gpt-image-future" },
            ],
          },
        }),
    );
    const generate = catalog.models.find(
      (model) => model.providerModelId === "gpt-image-2",
    )!;
    const edit = catalog.models.find(
      (model) => model.providerModelId === "gpt-image-2-edit",
    )!;
    expect(
      [generate, edit].map((model) => ({
        providerModelId: model.providerModelId,
        operations: Object.fromEntries(
          definedProviderModelOperations(model.operations).map(
            ([operation, definition]) => [
              operation,
              {
                parameters: definition.parameters.map((parameter) => ({
                  key: parameter.key,
                  valueType: parameter.valueType,
                  ...("values" in parameter
                    ? { values: parameter.values }
                    : {}),
                })),
              },
            ],
          ),
        ),
      })),
    ).toEqual(tokenHubImageParameters.models);
    expect(generate.inputModalities).toEqual(["text"]);
    expect(Object.keys(generate.operations)).toEqual(["image.generate"]);
    expect(edit.inputModalities).toEqual(["text", "image"]);
    expect(Object.keys(edit.operations)).toEqual(["image.edit"]);
    expect(
      edit.operations["image.edit"]?.parameters.map(({ key }) => key),
    ).toEqual(["aspectRatio", "quality", "outputFormat"]);
    expect(
      catalog.models.find(
        (model) => model.providerModelId === "gpt-image-future",
      ),
    ).toMatchObject({ completeness: "identity_only", operations: {} });
  });

  it("fails closed for unknown response shapes and ignores unmapped optional descriptors", async () => {
    await expect(
      discoverProviderModelCatalog(options("openai"), () =>
        Promise.resolve({
          statusCode: 200,
          body: [],
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });

    await expect(
      discoverProviderModelCatalog(options("openrouter"), () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            data: [
              {
                id: "example/image-model",
                architecture: {
                  input_modalities: ["text"],
                  output_modalities: ["image"],
                },
                supported_parameters: {
                  style: {
                    type: "object",
                  },
                },
              },
            ],
          },
        }),
      ),
    ).resolves.toMatchObject({
      models: [
        {
          operations: {
            "image.generate": {
              parameters: [],
            },
          },
        },
      ],
    });
  });

  it("bounds model count and pagination", async () => {
    await expect(
      discoverProviderModelCatalog(options("openai"), () =>
        Promise.resolve({
          statusCode: 200,
          body: {
            data: Array.from({ length: 2_001 }, (_value, index) => ({
              id: `model-${String(index)}`,
            })),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "model_limit",
    });

    let page = 0;
    await expect(
      discoverProviderModelCatalog(options("gemini"), () => {
        page += 1;
        return Promise.resolve({
          statusCode: 200,
          body: {
            models: [
              {
                name: `models/page-${String(page)}`,
              },
            ],
            nextPageToken: `next-${String(page)}`,
          },
        });
      }),
    ).rejects.toMatchObject({
      code: "page_limit",
    });
    expect(page).toBe(10);
  });

  it("normalizes authentication failures without exposing upstream bodies", async () => {
    await expect(
      discoverProviderModelCatalog(options("openai"), () =>
        Promise.resolve({
          statusCode: 401,
          body: {
            error: "secret upstream detail",
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderModelDiscoveryError>>({
        code: "authentication_failed",
        message: "Provider model discovery credential is invalid.",
      }),
    );
  });
});

const tokenHubImageParameters = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/contracts/test/fixtures/tokenhub-image-parameters.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { models: readonly unknown[] };
