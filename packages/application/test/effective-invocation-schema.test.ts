import type {
  ProviderModelParameterDefinition,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";
import { describe, expect, it } from "vitest";

import { projectEffectiveInvocationSchema } from "../src/modules/workflow-catalog/application/effective-invocation-schema.js";

const evidence = [
  {
    kind: "adapter_manifest" as const,
    reference: "test.images.v1",
    observedAt: "2026-08-12T00:00:00.000Z",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    confidence: "high" as const,
    claim: "supported" as const,
  },
];

function validationSchema(document: unknown) {
  return {
    schemaVersion: "kanvas.effective-invocation-validation-schema/v1" as const,
    document: JSON.stringify(document),
  };
}

function enumDefinition(
  key: string,
  values: readonly (string | number | boolean)[],
): ProviderModelParameterDefinition {
  return {
    key,
    label: key,
    required: false,
    valueType: "enum",
    values,
    evidence,
  };
}

function integerDefinition(
  key: string,
  minimum: number,
  maximum: number,
): ProviderModelParameterDefinition {
  return {
    key,
    label: key,
    required: false,
    valueType: "integer",
    minimum,
    maximum,
    evidence,
  };
}

function group(options: {
  readonly definitions: readonly ProviderModelParameterDefinition[];
  readonly policies: ProviderModelParameterPolicies;
}) {
  return {
    controlledParameterKeys: ["quality", "seed", "background"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          maxLength: 8_000,
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        seed: {
          type: "integer",
          minimum: 0,
          maximum: 4_294_967_295,
        },
        background: {
          type: "string",
          enum: ["auto", "transparent"],
        },
      },
    },
    candidates: [
      {
        parameterDefinitions: options.definitions,
        parameterPolicies: options.policies,
      },
    ],
  };
}

const workflowInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      "x-kanvas-ui": {
        placeholder: "Describe the image you want to create",
      },
      minLength: 1,
      maxLength: 8_000,
    },
    quality: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    seed: {
      type: "integer",
      minimum: 0,
      maximum: 4_294_967_295,
    },
    background: {
      type: "string",
      enum: ["auto", "transparent"],
    },
  },
};

describe("effective invocation schema", () => {
  it("keeps business fields and intersects only ready candidate domains", () => {
    const schema = projectEffectiveInvocationSchema({
      inputSchema: workflowInputSchema,
      routeGroups: [
        group({
          definitions: [
            enumDefinition("quality", ["low", "medium", "high"]),
            integerDefinition("seed", 0, 4_294_967_295),
            enumDefinition("background", ["auto", "transparent"]),
          ],
          policies: {
            quality: {
              callerPolicy: "optional",
              allowedValues: ["medium", "high"],
            },
            seed: {
              callerPolicy: "required",
              minimum: 10,
              maximum: 100,
            },
            background: {
              callerPolicy: "fixed",
              defaultValue: "auto",
            },
          },
        }),
        group({
          definitions: [
            enumDefinition("quality", ["low", "medium"]),
            integerDefinition("seed", 0, 50),
            enumDefinition("background", ["auto"]),
          ],
          policies: {
            quality: {
              callerPolicy: "optional",
            },
            seed: {
              callerPolicy: "optional",
              minimum: 20,
              maximum: 50,
            },
            background: {
              callerPolicy: "fixed",
              defaultValue: "auto",
            },
          },
        }),
      ],
    });

    expect(schema).toEqual({
      schemaVersion: "kanvas.effective-invocation-schema/v1",
      availability: "available",
      controlledParameterKeys: ["background", "quality", "seed"],
      validationSchema: validationSchema(workflowInputSchema),
      fields: [
        {
          key: "prompt",
          label: "Prompt",
          placeholder: "Describe the image you want to create",
          required: true,
          valueType: "string",
          maxLength: 8_000,
        },
        {
          key: "quality",
          label: "quality",
          required: false,
          valueType: "enum",
          values: ["medium"],
        },
        {
          key: "seed",
          label: "seed",
          required: true,
          valueType: "integer",
          minimum: 20,
          maximum: 50,
        },
      ],
    });
  });

  it("fails closed when a workflow requires a fixed parameter", () => {
    const schema = projectEffectiveInvocationSchema({
      inputSchema: {
        ...workflowInputSchema,
        required: ["prompt", "background"],
      },
      routeGroups: [
        group({
          definitions: [enumDefinition("background", ["auto", "transparent"])],
          policies: {
            background: {
              callerPolicy: "fixed",
              defaultValue: "auto",
            },
          },
        }),
      ],
    });

    expect(schema).toMatchObject({
      availability: "unavailable",
      reason: "schema_conflict",
    });
  });

  it("does not expose fixed or disabled controlled parameters", () => {
    const schema = projectEffectiveInvocationSchema({
      inputSchema: {
        ...workflowInputSchema,
        properties: {
          ...workflowInputSchema.properties,
          outputFormat: {
            type: "string",
            enum: ["png", "webp"],
          },
        },
      },
      routeGroups: [
        {
          controlledParameterKeys: ["background", "outputFormat"],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["prompt"],
            properties: {
              prompt: {
                type: "string",
                maxLength: 8_000,
              },
              background: {
                type: "string",
                enum: ["auto", "transparent"],
              },
              outputFormat: {
                type: "string",
                enum: ["png", "webp"],
              },
            },
          },
          candidates: [
            {
              parameterDefinitions: [
                enumDefinition("background", ["auto", "transparent"]),
                enumDefinition("outputFormat", ["png", "webp"]),
              ],
              parameterPolicies: {
                background: {
                  callerPolicy: "fixed",
                  defaultValue: "auto",
                },
                // No outputFormat policy means disabled.
              },
            },
          ],
        },
      ],
    });

    expect(schema.availability).toBe("available");
    if (schema.availability === "available") {
      expect(schema.fields.map((field) => field.key)).toEqual(["prompt"]);
    }
  });

  it("preserves required source business fields alongside Provider controls", () => {
    const schema = projectEffectiveInvocationSchema({
      inputSchema: {
        ...workflowInputSchema,
        required: ["sourceArtifactId", "prompt"],
        properties: {
          sourceArtifactId: {
            type: "string",
            pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
          },
          ...workflowInputSchema.properties,
        },
      },
      routeGroups: [
        {
          ...group({
            definitions: [enumDefinition("quality", ["medium", "high"])],
            policies: {
              quality: {
                callerPolicy: "optional",
              },
            },
          }),
          inputSchema: {
            ...group({
              definitions: [],
              policies: {},
            }).inputSchema,
            required: ["sourceArtifactId", "prompt"],
            properties: {
              sourceArtifactId: {
                type: "string",
                pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
              },
              ...group({
                definitions: [],
                policies: {},
              }).inputSchema.properties,
            },
          },
        },
      ],
    });

    expect(schema.availability).toBe("available");
    if (schema.availability === "available") {
      expect(
        schema.fields
          .filter((field) => ["sourceArtifactId", "prompt"].includes(field.key))
          .map((field) => ({
            key: field.key,
            required: field.required,
            valueType: field.valueType,
          })),
      ).toEqual([
        {
          key: "sourceArtifactId",
          required: true,
          valueType: "artifact",
        },
        {
          key: "prompt",
          required: true,
          valueType: "string",
        },
      ]);
    }
  });

  it("projects image references and masks as typed Artifact fields", () => {
    const artifact = {
      type: "string",
      pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
    };
    const references = {
      type: "array",
      minItems: 1,
      maxItems: 14,
      uniqueItems: true,
      items: artifact,
    };
    const schema = projectEffectiveInvocationSchema({
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["sourceArtifactId", "prompt"],
        properties: {
          sourceArtifactId: artifact,
          maskArtifactId: artifact,
          referenceArtifactIds: references,
          prompt: {
            type: "string",
            maxLength: 8_000,
          },
        },
      },
      routeGroups: [
        {
          controlledParameterKeys: [],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["sourceArtifactId", "prompt"],
            properties: {
              sourceArtifactId: artifact,
              maskArtifactId: artifact,
              referenceArtifactIds: references,
              prompt: {
                type: "string",
                maxLength: 8_000,
              },
            },
          },
          candidates: [],
        },
      ],
    });

    expect(schema).toMatchObject({
      availability: "available",
      fields: [
        {
          key: "sourceArtifactId",
          required: true,
          valueType: "artifact",
        },
        {
          key: "maskArtifactId",
          required: false,
          valueType: "artifact",
        },
        {
          key: "referenceArtifactIds",
          required: false,
          valueType: "artifact_list",
          minItems: 1,
          maxItems: 14,
          uniqueItems: true,
        },
        {
          key: "prompt",
          required: true,
          valueType: "string",
        },
      ],
    });
  });

  it("keeps required canvas placement objects as JSON inputs", () => {
    const placement = {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: {
          type: "integer",
          minimum: 0,
          maximum: 1535,
        },
        y: {
          type: "integer",
          minimum: 0,
          maximum: 1535,
        },
      },
    };
    const region = {
      type: "object",
      additionalProperties: false,
      required: ["left", "top", "right", "bottom"],
      properties: {
        left: { type: "integer", minimum: 0 },
        top: { type: "integer", minimum: 0 },
        right: { type: "integer", minimum: 0 },
        bottom: { type: "integer", minimum: 0 },
      },
    };
    const inputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["sourcePlacement", "generatedRegion"],
      properties: {
        sourcePlacement: placement,
        generatedRegion: region,
      },
    };
    const schema = projectEffectiveInvocationSchema({
      inputSchema,
      routeGroups: [
        {
          controlledParameterKeys: [],
          inputSchema,
          candidates: [],
        },
      ],
    });

    expect(schema).toMatchObject({
      availability: "available",
      fields: [
        {
          key: "sourcePlacement",
          required: true,
          valueType: "json",
          jsonType: "object",
        },
        {
          key: "generatedRegion",
          required: true,
          valueType: "json",
          jsonType: "object",
        },
      ],
    });
    if (schema.availability === "available") {
      expect(JSON.parse(schema.validationSchema.document)).toEqual(inputSchema);
    }
  });

  it("preserves image object removal's root oneOf in the validation schema", () => {
    const artifact = {
      type: "string",
      pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
    };
    const inputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["sourceArtifactId"],
      oneOf: [{ required: ["maskArtifactId"] }, { required: ["regions"] }],
      properties: {
        sourceArtifactId: artifact,
        maskArtifactId: artifact,
        regions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["points"],
            properties: {
              points: {
                type: "array",
                minItems: 3,
                items: {
                  type: "object",
                },
              },
            },
          },
        },
      },
    };
    const schema = projectEffectiveInvocationSchema({
      inputSchema,
      routeGroups: [
        {
          controlledParameterKeys: [],
          inputSchema,
          candidates: [],
        },
      ],
    });
    expect(schema.availability).toBe("available");
    if (schema.availability === "available") {
      expect(JSON.parse(schema.validationSchema.document)).toEqual(inputSchema);
    }
  });

  it("represents scalar constants as non-editable invocation defaults", () => {
    const inputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion"],
      properties: {
        schemaVersion: {
          const: "kanvas.image-request/v1",
        },
      },
    };
    const schema = projectEffectiveInvocationSchema({
      inputSchema,
      routeGroups: [],
    });

    expect(schema).toEqual({
      schemaVersion: "kanvas.effective-invocation-schema/v1",
      availability: "available",
      controlledParameterKeys: [],
      validationSchema: validationSchema(inputSchema),
      fields: [
        {
          key: "schemaVersion",
          label: "schemaVersion",
          required: true,
          valueType: "constant",
          value: "kanvas.image-request/v1",
        },
      ],
    });
  });

  it("distinguishes a valid empty input from unavailable", () => {
    const inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: {},
    };
    expect(
      projectEffectiveInvocationSchema({
        inputSchema,
        routeGroups: [],
      }),
    ).toEqual({
      schemaVersion: "kanvas.effective-invocation-schema/v1",
      availability: "available",
      controlledParameterKeys: [],
      validationSchema: validationSchema(inputSchema),
      fields: [],
    });
  });
});
