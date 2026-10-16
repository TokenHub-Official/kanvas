import { describe, expect, it } from "vitest";

import {
  validateWorkflowAuthoringFields,
  workflowArtifactIdPattern,
  workflowAuthoringFieldKind,
  workflowAuthoringSchemaForKind,
  workflowFieldPlaceholder,
  workflowFieldRenderKey,
  withWorkflowEnumValues,
  withWorkflowFieldPlaceholder,
} from "./workflow-authoring-field-schema-v1.js";

describe("workflow authoring field schema", () => {
  it("projects single and multiple files to artifact-compatible JSON Schema", () => {
    const single = workflowAuthoringSchemaForKind("file");
    const multiple = workflowAuthoringSchemaForKind("file_list");
    expect(single).toMatchObject({
      type: "string",
      pattern: workflowArtifactIdPattern,
    });
    expect(multiple).toMatchObject({
      type: "array",
      items: { type: "string", pattern: workflowArtifactIdPattern },
    });
    expect(workflowAuthoringFieldKind(single)).toBe("file");
    expect(workflowAuthoringFieldKind(multiple)).toBe("file_list");
  });

  it("stores array choices on the item schema", () => {
    expect(
      withWorkflowEnumValues(workflowAuthoringSchemaForKind("array"), [
        "square",
        "portrait",
      ]),
    ).toMatchObject({
      items: { enum: ["square", "portrait"] },
    });
  });

  it("recognizes oneOf objects and const domains", () => {
    expect(
      workflowAuthoringFieldKind({
        oneOf: [{ type: "object", properties: { kind: { const: "color" } } }],
      }),
    ).toBe("object");
    expect(workflowAuthoringFieldKind({ const: "auto" })).toBe("string");
    expect(workflowAuthoringFieldKind({ const: 2 })).toBe("number");
  });

  it("detects duplicate keys and inverted ranges", () => {
    expect(
      validateWorkflowAuthoringFields([
        {
          key: "prompt",
          label: "Prompt",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 2 },
        },
        {
          key: "prompt",
          label: "Other",
          required: false,
          schema: { type: "string" },
        },
      ]).map((issue) => issue.code),
    ).toEqual(["duplicate_key", "range_invalid", "duplicate_key"]);
  });

  it("keeps the rendered row identity stable while the editable key changes", () => {
    expect(workflowFieldRenderKey(0)).toBe(workflowFieldRenderKey(0));
  });

  it("stores placeholder with the field schema and removes it with the field", () => {
    const schema = withWorkflowFieldPlaceholder(
      { type: "string", description: "Describe the product" },
      "For example: red running shoes",
    );
    expect(workflowFieldPlaceholder(schema)).toBe(
      "For example: red running shoes",
    );
    expect(withWorkflowFieldPlaceholder(schema, "")).toEqual({
      type: "string",
      description: "Describe the product",
    });
  });
});
