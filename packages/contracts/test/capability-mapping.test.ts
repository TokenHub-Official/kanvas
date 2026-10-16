import {
  type CapabilityMappingError,
  compileCapabilityMappingPlanV1,
  executeCapabilityMappingPlanV1,
  parseCompiledCapabilityMappingPlanV1,
} from "../src/capability/index.js";
import { describe, expect, it } from "vitest";

const contractInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceArtifactId", "qualityIntent"],
  properties: {
    sourceArtifactId: {
      type: "string",
      "x-kanvas-semantic-type": "artifact.image",
    },
    qualityIntent: {
      type: "string",
      enum: ["faithful", "reconstructive"],
      "x-kanvas-semantic-type": "image.quality-intent",
    },
    scaleFactor: {
      type: "integer",
      const: 2,
      default: 2,
      "x-kanvas-semantic-type": "image.scale-factor",
    },
  },
} as const;

const configurationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kernel: {
      type: "string",
      enum: ["lanczos3"],
    },
  },
} as const;

const adapterInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["artifactId", "mode", "scale", "kernel"],
  properties: {
    artifactId: {
      type: "string",
      "x-kanvas-semantic-type": "artifact.image",
    },
    mode: {
      type: "string",
      enum: ["resample", "reconstruct"],
      "x-kanvas-semantic-type": "adapter.upscale-mode",
    },
    scale: {
      type: "integer",
      const: 2,
      "x-kanvas-semantic-type": "image.scale-factor",
    },
    kernel: {
      type: "string",
      enum: ["lanczos3"],
    },
  },
} as const;

describe("capability mapping V1", () => {
  it("compiles and executes a typed capability-to-adapter mapping", () => {
    const plan = compileCapabilityMappingPlanV1({
      document: {
        schemaVersion: "kanvas.capability-mapping/v1",
        direction: "input",
        expression: {
          op: "object",
          properties: {
            artifactId: {
              op: "source",
              root: "input",
              pointer: "/sourceArtifactId",
            },
            mode: {
              op: "enum_map",
              value: {
                op: "source",
                root: "input",
                pointer: "/qualityIntent",
              },
              cases: {
                faithful: "resample",
                reconstructive: "reconstruct",
              },
              semanticType: "adapter.upscale-mode",
            },
            scale: {
              op: "default",
              value: {
                op: "source",
                root: "input",
                pointer: "/scaleFactor",
              },
              fallback: { op: "constant", value: 2 },
            },
            kernel: {
              op: "default",
              value: {
                op: "source",
                root: "configuration",
                pointer: "/kernel",
              },
              fallback: { op: "constant", value: "lanczos3" },
            },
          },
        },
      },
      sourceSchemas: {
        input: contractInputSchema,
        configuration: configurationSchema,
      },
      targetSchema: adapterInputSchema,
    });

    expect(plan).toMatchObject({
      schemaVersion: "kanvas.compiled-capability-mapping/v1",
      direction: "input",
    });
    expect(
      executeCapabilityMappingPlanV1(plan, {
        input: {
          sourceArtifactId: "01K4YQ9E6GF3TW8JGYG88F70N3",
          qualityIntent: "faithful",
        },
        configuration: {},
      }),
    ).toEqual({
      artifactId: "01K4YQ9E6GF3TW8JGYG88F70N3",
      kernel: "lanczos3",
      mode: "resample",
      scale: 2,
    });
  });

  it("rejects missing required target fields at publication time", () => {
    expect(() =>
      compileCapabilityMappingPlanV1({
        document: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: {
            op: "object",
            properties: {
              artifactId: {
                op: "source",
                root: "input",
                pointer: "/sourceArtifactId",
              },
            },
          },
        },
        sourceSchemas: { input: contractInputSchema },
        targetSchema: adapterInputSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "missing_required_target",
      }),
    );
  });

  it("rejects semantic mismatches and remote schema references", () => {
    expect(() =>
      compileCapabilityMappingPlanV1({
        document: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: {
            op: "object",
            properties: {
              artifactId: {
                op: "source",
                root: "input",
                pointer: "/qualityIntent",
              },
              mode: { op: "constant", value: "resample" },
              scale: { op: "constant", value: 2 },
              kernel: { op: "constant", value: "lanczos3" },
            },
          },
        },
        sourceSchemas: { input: contractInputSchema },
        targetSchema: adapterInputSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "semantic_mismatch",
      }),
    );

    expect(() =>
      compileCapabilityMappingPlanV1({
        document: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "output",
          expression: { op: "source", root: "result", pointer: "" },
        },
        sourceSchemas: { result: { $ref: "https://example.com/result.json" } },
        targetSchema: { type: "object" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "remote_reference_forbidden",
      }),
    );
  });

  it("does not expose scripts or cross-direction sources", () => {
    expect(() =>
      compileCapabilityMappingPlanV1({
        document: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: { op: "source", root: "result", pointer: "" },
        },
        sourceSchemas: { result: { type: "object" } },
        targetSchema: { type: "object" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "source_not_permitted",
      }),
    );

    expect(() =>
      compileCapabilityMappingPlanV1({
        document: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: { op: "script", source: "fetch('https://example.com')" },
        },
        sourceSchemas: { input: { type: "object" } },
        targetSchema: { type: "object" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "invalid_expression",
      }),
    );
  });

  it("parses stored compiled plans and rejects non-canonical tampering", () => {
    const stored = {
      schemaVersion: "kanvas.compiled-capability-mapping/v1",
      direction: "input",
      expression: {
        op: "object",
        properties: [
          ["artifactId", { op: "source", root: "input", path: ["source"] }],
          ["scale", { op: "constant", value: 2 }],
        ],
      },
    };
    const plan = parseCompiledCapabilityMappingPlanV1(stored);
    expect(
      executeCapabilityMappingPlanV1(plan, { input: { source: "artifact" } }),
    ).toEqual({ artifactId: "artifact", scale: 2 });

    expect(() =>
      parseCompiledCapabilityMappingPlanV1({
        ...stored,
        expression: {
          ...stored.expression,
          properties: [...stored.expression.properties].reverse(),
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CapabilityMappingError>>({
        code: "invalid_expression",
      }),
    );
  });
});
