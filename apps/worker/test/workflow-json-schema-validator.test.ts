import { describe, expect, it } from "vitest";

import { createWorkflowJsonSchemaValidationPort } from "../src/queue/workflow-json-schema-validator.js";

describe("Workflow JSON Schema validation port", () => {
  it("validates without coercion, defaults, or mutation", () => {
    const validator = createWorkflowJsonSchemaValidationPort();
    const value = {
      count: "1",
    };

    expect(
      validator.validate(
        {
          type: "object",
          additionalProperties: false,
          required: ["count"],
          properties: {
            count: {
              type: "integer",
            },
          },
        },
        value,
      ),
    ).toEqual(["/count must be integer"]);
    expect(value).toEqual({
      count: "1",
    });
  });

  it("fails closed with a bounded issue for an invalid schema", () => {
    const validator = createWorkflowJsonSchemaValidationPort();

    expect(
      validator.validate(
        {
          type: "not-a-json-schema-type",
        },
        {},
      ),
    ).toEqual(["schema is not a valid JSON Schema"]);
  });

  it("supports valid conditional schemas without strict annotations", () => {
    const validator = createWorkflowJsonSchemaValidationPort();

    expect(
      validator.validate(
        {
          type: "object",
          required: ["background"],
          properties: {
            background: {
              type: "object",
            },
          },
          allOf: [
            {
              if: {
                properties: {
                  background: {
                    properties: {
                      kind: {
                        const: "artifact",
                      },
                    },
                  },
                },
              },
              then: {
                properties: {
                  background: {
                    required: ["artifactId"],
                  },
                },
              },
            },
          ],
        },
        {
          background: {
            kind: "color",
            color: "#FFFFFFFF",
          },
        },
      ),
    ).toEqual([]);
  });

  it("accepts Provider invocation annotations while enforcing their properties", () => {
    const validator = createWorkflowJsonSchemaValidationPort();
    const schema = {
      type: "object",
      additionalProperties: false,
      "x-kanvas-provider-model-operation": "image.generate",
      "x-kanvas-provider-parameter-keys": ["quality"],
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
        },
        quality: {
          type: "string",
          enum: ["low"],
        },
      },
    };

    expect(
      validator.validate(schema, {
        prompt: "A blue circle",
        quality: "low",
      }),
    ).toEqual([]);
    expect(
      validator.validate(schema, {
        prompt: "A blue circle",
        quality: "high",
      }),
    ).toEqual(["/quality must be equal to one of the allowed values"]);
  });

  it("accepts governed capability and authoring annotations", () => {
    const validator = createWorkflowJsonSchemaValidationPort();

    expect(
      validator.validate(
        {
          type: "object",
          additionalProperties: false,
          required: ["sourceArtifactId"],
          properties: {
            sourceArtifactId: {
              type: "string",
              pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
              "x-kanvas-semantic-type": "artifact.image",
              "x-kanvas-file": { categories: ["image"] },
              "x-kanvas-ui": { placeholder: "Choose an image" },
            },
          },
        },
        { sourceArtifactId: "01K00000000000000000000000" },
      ),
    ).toEqual([]);
  });
});
