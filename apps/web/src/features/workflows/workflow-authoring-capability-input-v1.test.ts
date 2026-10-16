import { describe, expect, it } from "vitest";

import {
  workflowCapabilityInputDefaults,
  workflowCapabilityInputWithDefaults,
} from "./workflow-authoring-capability-input-v1.js";

describe("workflow capability input defaults", () => {
  const schema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["fast", "quality"], default: "quality" },
      seed: { type: "integer" },
      enabled: { type: "boolean", default: true },
    },
  };

  it("projects schema defaults into literal bindings", () => {
    expect(workflowCapabilityInputDefaults(schema)).toEqual({
      kind: "object",
      fields: {
        mode: { kind: "literal", value: "quality" },
        enabled: { kind: "literal", value: true },
      },
    });
  });

  it("preserves explicit bindings over schema defaults", () => {
    expect(
      workflowCapabilityInputWithDefaults(schema, {
        kind: "object",
        fields: { mode: { kind: "literal", value: "fast" } },
      }),
    ).toEqual({
      kind: "object",
      fields: {
        mode: { kind: "literal", value: "fast" },
        enabled: { kind: "literal", value: true },
      },
    });
  });

  it("hydrates authoring initials for required structured compose fields", () => {
    const localized = { "zh-CN": "字段", "en-US": "Field" };
    expect(
      workflowCapabilityInputDefaults(
        {
          type: "object",
          properties: {
            background: { oneOf: [{ type: "object" }] },
            canvas: { type: "object" },
            placement: { type: "object" },
          },
        },
        {
          schemaVersion: "kanvas.capability-declaration/v1",
          origin: "declared",
          catalog: {
            title: localized,
            category: localized,
            sourceKind: "built_in",
            tags: [],
          },
          parameters: [
            {
              key: "background",
              label: localized,
              semanticType: "background.source",
              required: true,
              exposurePolicy: {
                allowed: ["workflow_author"],
                default: "workflow_author",
              },
              sourcePolicy: {
                allowed: ["constant"],
                default: "constant",
              },
              editor: "background_source",
              defaultValue: { kind: "color", color: "#FFFFFFFF" },
            },
            {
              key: "canvas",
              label: localized,
              semanticType: "layout.canvas",
              required: true,
              exposurePolicy: {
                allowed: ["workflow_author"],
                default: "workflow_author",
              },
              sourcePolicy: {
                allowed: ["constant"],
                default: "constant",
              },
              editor: "canvas_size",
              defaultValue: { width: 1024, height: 1024 },
            },
            {
              key: "placement",
              label: localized,
              semanticType: "layout.placement",
              required: true,
              exposurePolicy: {
                allowed: ["workflow_author"],
                default: "workflow_author",
              },
              sourcePolicy: {
                allowed: ["constant"],
                default: "constant",
              },
              editor: "placement",
              defaultValue: {
                x: 0,
                y: 0,
                width: 1024,
                height: 1024,
                fit: "contain",
                opacity: 1,
              },
            },
          ],
          outputs: [],
          uiProfileKey: "background_compose",
        },
      ),
    ).toMatchObject({
      kind: "object",
      fields: {
        background: {
          kind: "literal",
          value: { kind: "color", color: "#FFFFFFFF" },
        },
        canvas: { kind: "literal", value: { width: 1024, height: 1024 } },
        placement: { kind: "literal", value: { fit: "contain", opacity: 1 } },
      },
    });
  });
});
