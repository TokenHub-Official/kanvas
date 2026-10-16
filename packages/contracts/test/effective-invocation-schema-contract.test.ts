import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { EffectiveInvocationSchema } from "../src/api/schemas.js";
import {
  createEffectiveInvocationValidationSchema,
  effectiveInvocationSchemaInvariantIssues,
  validateEffectiveInvocationInput,
} from "../src/api/effective-invocation-validation.js";

const validationSchema = {
  schemaVersion: "kanvas.effective-invocation-validation-schema/v1" as const,
  document: '{"type":"object","additionalProperties":false,"properties":{}}',
};

describe("Effective invocation schema contract", () => {
  it("carries typed Artifact and structured business fields", () => {
    expect(
      Value.Check(EffectiveInvocationSchema, {
        schemaVersion: "kanvas.effective-invocation-schema/v1",
        availability: "available",
        controlledParameterKeys: ["quality"],
        validationSchema,
        fields: [
          {
            key: "sourceArtifactId",
            label: "Source",
            required: true,
            valueType: "artifact",
          },
          {
            key: "referenceArtifactIds",
            label: "References",
            required: false,
            valueType: "artifact_list",
            minItems: 1,
            maxItems: 14,
            uniqueItems: true,
          },
          {
            key: "sourcePlacement",
            label: "Source placement",
            required: true,
            valueType: "json",
            jsonType: "object",
            maxLength: 32_000,
          },
          {
            key: "schemaVersion",
            label: "Schema version",
            required: true,
            valueType: "constant",
            value: "kanvas.image-edit/v1",
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects unbounded or ambiguous structured fields", () => {
    expect(
      Value.Check(EffectiveInvocationSchema, {
        schemaVersion: "kanvas.effective-invocation-schema/v1",
        availability: "available",
        controlledParameterKeys: [],
        validationSchema,
        fields: [
          {
            key: "referenceArtifactIds",
            label: "References",
            required: false,
            valueType: "artifact_list",
            minItems: 1,
            maxItems: 500,
            uniqueItems: true,
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(EffectiveInvocationSchema, {
        schemaVersion: "kanvas.effective-invocation-schema/v1",
        availability: "available",
        controlledParameterKeys: [],
        validationSchema,
        fields: [
          {
            key: "sourcePlacement",
            label: "Source placement",
            required: true,
            valueType: "json",
            maxLength: 32_000,
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(EffectiveInvocationSchema, {
        schemaVersion: "kanvas.effective-invocation-schema/v1",
        availability: "available",
        controlledParameterKeys: [],
        validationSchema: {
          schemaVersion: "kanvas.effective-invocation-validation-schema/v1",
          document: "x".repeat(131_073),
        },
        fields: [],
      }),
    ).toBe(false);
  });

  it("rejects duplicate field keys and inverted Artifact list bounds through the parser invariant", () => {
    expect(
      effectiveInvocationSchemaInvariantIssues({
        schemaVersion: "kanvas.effective-invocation-schema/v1",
        availability: "available",
        controlledParameterKeys: [],
        validationSchema,
        fields: [
          {
            key: "references",
            label: "References",
            required: false,
            valueType: "artifact_list",
            minItems: 2,
            maxItems: 1,
            uniqueItems: true,
          },
          {
            key: "references",
            label: "References again",
            required: false,
            valueType: "artifact",
          },
        ],
      }),
    ).toEqual([
      "Invalid Artifact list bounds: references.",
      "Duplicate invocation field: references.",
    ]);
  });

  it("carries a bounded schema document and validates nested constraints and root oneOf", () => {
    const schema = createEffectiveInvocationValidationSchema({
      type: "object",
      additionalProperties: false,
      required: ["sourceArtifactId"],
      oneOf: [{ required: ["maskArtifactId"] }, { required: ["regions"] }],
      properties: {
        sourceArtifactId: { type: "string" },
        maskArtifactId: { type: "string" },
        regions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["x"],
            properties: {
              x: { type: "number", minimum: 0 },
            },
          },
        },
      },
    });
    expect(schema).toBeDefined();
    expect(
      validateEffectiveInvocationInput(schema!, {
        sourceArtifactId: "source",
      }),
    ).not.toEqual([]);
    expect(
      validateEffectiveInvocationInput(schema!, {
        sourceArtifactId: "source",
        maskArtifactId: "mask",
        regions: [{ x: 1 }],
      }),
    ).not.toEqual([]);
    expect(
      validateEffectiveInvocationInput(schema!, {
        sourceArtifactId: "source",
        regions: [{ x: -1 }],
      }),
    ).not.toEqual([]);
    expect(
      validateEffectiveInvocationInput(schema!, {
        sourceArtifactId: "source",
        regions: [{ x: 1 }],
      }),
    ).toEqual([]);
  });

  it("accepts the governed semantic annotation used by capability contracts", () => {
    const schema = createEffectiveInvocationValidationSchema({
      type: "object",
      additionalProperties: false,
      required: ["sourceArtifactId"],
      properties: {
        sourceArtifactId: {
          type: "string",
          pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
          "x-kanvas-semantic-type": "artifact.image",
        },
      },
    });

    expect(schema).toBeDefined();
    expect(
      validateEffectiveInvocationInput(schema!, {
        sourceArtifactId: "01K00000000000000000000000",
      }),
    ).toEqual([]);
  });
});
