import { describe, expect, it } from "vitest";

import {
  effectiveInvocationInput,
  integerInvocationValue,
  requiredInvocationField,
  scalarOptionToken,
  valueFromScalarOption,
} from "./effective-invocation-input.js";

function validationSchema(document: unknown) {
  return {
    schemaVersion: "kanvas.effective-invocation-validation-schema/v1" as const,
    document: JSON.stringify(document),
  };
}

const scalarInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 8_000 },
    quality: { type: "string", enum: ["medium", "high"] },
    seed: {
      type: "integer",
      minimum: 0,
      maximum: 4_294_967_295,
    },
    transparent: { type: "boolean" },
  },
};

const schema = {
  schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
  availability: "available" as const,
  controlledParameterKeys: ["quality", "seed"],
  validationSchema: validationSchema(scalarInputSchema),
  fields: [
    {
      key: "prompt",
      label: "Prompt",
      required: true,
      valueType: "string" as const,
      maxLength: 8_000,
    },
    {
      key: "quality",
      label: "Quality",
      required: false,
      valueType: "enum" as const,
      values: ["medium", "high"],
    },
    {
      key: "seed",
      label: "Seed",
      required: false,
      valueType: "integer" as const,
      minimum: 0,
      maximum: 4_294_967_295,
    },
    {
      key: "transparent",
      label: "Transparent",
      required: false,
      valueType: "boolean" as const,
    },
  ],
};

const sourceId = "01K00000000000000000000011";
const maskId = "01K00000000000000000000012";
const referenceId = "01K00000000000000000000013";
const structuredInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "sourceArtifactId",
    "sourcePlacement",
    "generatedRegion",
  ],
  properties: {
    schemaVersion: { const: "kanvas.image-edit/v1" },
    sourceArtifactId: {
      type: "string",
      pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
    },
    maskArtifactId: {
      type: "string",
      pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
    },
    referenceArtifactIds: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: {
        type: "string",
        pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
      },
    },
    sourcePlacement: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1535 },
        y: { type: "integer", minimum: 0, maximum: 1535 },
      },
    },
    generatedRegion: {
      type: "object",
      additionalProperties: false,
      required: ["left", "top", "right", "bottom"],
      properties: {
        left: { type: "integer", minimum: 0, maximum: 1535 },
        top: { type: "integer", minimum: 0, maximum: 1535 },
        right: { type: "integer", minimum: 0, maximum: 1535 },
        bottom: { type: "integer", minimum: 0, maximum: 1535 },
      },
    },
  },
};
const structuredSchema = {
  schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
  availability: "available" as const,
  controlledParameterKeys: [],
  validationSchema: validationSchema(structuredInputSchema),
  fields: [
    {
      key: "schemaVersion",
      label: "Schema version",
      required: true,
      valueType: "constant" as const,
      value: "kanvas.image-edit/v1",
    },
    {
      key: "sourceArtifactId",
      label: "Source",
      required: true,
      valueType: "artifact" as const,
    },
    {
      key: "maskArtifactId",
      label: "Mask",
      required: false,
      valueType: "artifact" as const,
    },
    {
      key: "referenceArtifactIds",
      label: "References",
      required: false,
      valueType: "artifact_list" as const,
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    },
    {
      key: "sourcePlacement",
      label: "Source placement",
      required: true,
      valueType: "json" as const,
      jsonType: "object" as const,
      maxLength: 2_000,
    },
    {
      key: "generatedRegion",
      label: "Generated region",
      required: true,
      valueType: "json" as const,
      jsonType: "object" as const,
      maxLength: 2_000,
    },
  ],
};

describe("effective invocation input", () => {
  it("preserves enum, integer, and boolean types and omits unset values", () => {
    expect(
      effectiveInvocationInput(schema, {
        prompt: "  Make a poster  ",
        quality: "high",
        seed: 4_294_967_295,
        transparent: false,
        stale: "must not leak",
      }),
    ).toEqual({
      prompt: "Make a poster",
      quality: "high",
      seed: 4_294_967_295,
      transparent: false,
    });
  });

  it("rejects boolean values outside the effective allowed set", () => {
    expect(() =>
      effectiveInvocationInput(
        {
          ...schema,
          validationSchema: validationSchema({
            ...scalarInputSchema,
            properties: {
              ...scalarInputSchema.properties,
              transparent: {
                type: "boolean",
                enum: [true],
              },
            },
          }),
          fields: schema.fields.map((field) =>
            field.key === "transparent"
              ? {
                  ...field,
                  valueType: "boolean" as const,
                  allowedValues: [true],
                }
              : field,
          ),
        },
        {
          prompt: "ready",
          transparent: false,
        },
      ),
    ).toThrow(/not a boolean/u);
  });

  it("round-trips typed enum tokens and parses only safe integers", () => {
    const quality = schema.fields[1]!;
    expect(valueFromScalarOption(quality, scalarOptionToken("high"))).toBe(
      "high",
    );
    expect(integerInvocationValue("4294967295")).toBe(4_294_967_295);
    expect(integerInvocationValue("1.5")).toBeUndefined();
    expect(integerInvocationValue("-12")).toBe(-12);
  });

  it("finds required fields without treating false as missing", () => {
    expect(
      requiredInvocationField(schema.fields, {
        prompt: "",
        transparent: false,
      })?.key,
    ).toBe("prompt");
    expect(
      requiredInvocationField(schema.fields, {
        prompt: "ready",
        transparent: false,
      }),
    ).toBeUndefined();
  });

  it("parses Artifact IDs, lists and structured JSON without leaking unknown fields", () => {
    expect(
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: ` ${sourceId} `,
        maskArtifactId: maskId,
        referenceArtifactIds: `${referenceId},\n${maskId}`,
        sourcePlacement: '{ "x": 12, "y": 24 }',
        generatedRegion: '{ "left": 0, "top": 0, "right": 640, "bottom": 480 }',
        stale: "must not leak",
      }),
    ).toEqual({
      schemaVersion: "kanvas.image-edit/v1",
      sourceArtifactId: sourceId,
      maskArtifactId: maskId,
      referenceArtifactIds: [referenceId, maskId],
      sourcePlacement: { x: 12, y: 24 },
      generatedRegion: {
        left: 0,
        top: 0,
        right: 640,
        bottom: 480,
      },
    });
  });

  it("rejects malformed structured invocation values and constant overrides", () => {
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: "not-an-artifact",
        sourcePlacement: "{}",
        generatedRegion: "{}",
      }),
    ).toThrow(/Artifact ID/u);
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: sourceId,
        referenceArtifactIds: `${referenceId}\n${referenceId}`,
        sourcePlacement: "{}",
        generatedRegion: "{}",
      }),
    ).toThrow(/Artifact ID list/u);
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: sourceId,
        referenceArtifactIds: [referenceId, 1],
        sourcePlacement: "{}",
        generatedRegion: "{}",
      }),
    ).toThrow(/Artifact ID list/u);
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: sourceId,
        sourcePlacement: "{",
        generatedRegion: "{}",
      }),
    ).toThrow(/not valid JSON/u);
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        schemaVersion: "override",
        sourceArtifactId: sourceId,
        sourcePlacement: "{}",
        generatedRegion: "{}",
      }),
    ).toThrow(/constant value/u);
  });

  it("treats constants as satisfied but still rejects missing required structured fields", () => {
    expect(
      requiredInvocationField(structuredSchema.fields, {
        sourceArtifactId: sourceId,
        sourcePlacement: "{}",
        generatedRegion: "{}",
      }),
    ).toBeUndefined();
    expect(() =>
      effectiveInvocationInput(structuredSchema, {
        sourceArtifactId: sourceId,
        sourcePlacement: "{}",
      }),
    ).toThrow(/generatedRegion is required/u);
  });

  it("validates required canvas placement members, bounds, and unknown fields", () => {
    const validRegion = '{ "left": 0, "top": 0, "right": 640, "bottom": 480 }';
    for (const sourcePlacement of [
      "{}",
      '{ "x": 1536, "y": 24 }',
      '{ "x": 12, "y": 24, "unknown": true }',
    ]) {
      expect(() =>
        effectiveInvocationInput(structuredSchema, {
          sourceArtifactId: sourceId,
          sourcePlacement,
          generatedRegion: validRegion,
        }),
      ).toThrow(/validation schema/u);
    }
  });

  it("enforces image object removal's root oneOf and nested region schema", () => {
    const objectRemoveSchema = {
      schemaVersion: "kanvas.effective-invocation-schema/v1" as const,
      availability: "available" as const,
      controlledParameterKeys: [],
      validationSchema: validationSchema({
        type: "object",
        additionalProperties: false,
        required: ["sourceArtifactId"],
        oneOf: [{ required: ["maskArtifactId"] }, { required: ["regions"] }],
        properties: {
          sourceArtifactId: structuredInputSchema.properties.sourceArtifactId,
          maskArtifactId: structuredInputSchema.properties.maskArtifactId,
          regions: {
            type: "array",
            minItems: 1,
            maxItems: 128,
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
                    additionalProperties: false,
                    required: ["x", "y"],
                    properties: {
                      x: {
                        type: "number",
                        minimum: 0,
                        maximum: 16_384,
                      },
                      y: {
                        type: "number",
                        minimum: 0,
                        maximum: 16_384,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      fields: [
        {
          key: "sourceArtifactId",
          label: "Source",
          required: true,
          valueType: "artifact" as const,
        },
        {
          key: "maskArtifactId",
          label: "Mask",
          required: false,
          valueType: "artifact" as const,
        },
        {
          key: "regions",
          label: "Regions",
          required: false,
          valueType: "json" as const,
          jsonType: "array" as const,
          maxLength: 32_000,
        },
      ],
    };
    expect(() =>
      effectiveInvocationInput(objectRemoveSchema, {
        sourceArtifactId: sourceId,
      }),
    ).toThrow(/validation schema/u);
    expect(() =>
      effectiveInvocationInput(objectRemoveSchema, {
        sourceArtifactId: sourceId,
        maskArtifactId: maskId,
        regions: '[{"points":[{"x":0,"y":0},{"x":1,"y":0},{"x":0,"y":1}]}]',
      }),
    ).toThrow(/validation schema/u);
    expect(() =>
      effectiveInvocationInput(objectRemoveSchema, {
        sourceArtifactId: sourceId,
        regions: '[{"points":[{"x":0,"y":0}]}]',
      }),
    ).toThrow(/validation schema/u);
    expect(
      effectiveInvocationInput(objectRemoveSchema, {
        sourceArtifactId: sourceId,
        maskArtifactId: maskId,
      }),
    ).toEqual({
      sourceArtifactId: sourceId,
      maskArtifactId: maskId,
    });
  });
});
