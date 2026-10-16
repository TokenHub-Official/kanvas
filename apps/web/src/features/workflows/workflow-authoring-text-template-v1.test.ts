import { describe, expect, it } from "vitest";

import {
  insertWorkflowVariableToken,
  workflowVariableIdentity,
  workflowTextTemplateBinding,
  workflowTextTemplateSource,
} from "./workflow-authoring-text-template-v1.js";

const variables = [
  {
    id: "input:product_name",
    variable: {
      source: "workflow_input" as const,
      path: ["product_name"],
    },
  },
];

describe("workflow authoring text template", () => {
  it("round-trips literal text with embedded upstream variables", () => {
    const source = "为 {{input:product_name}} 生成一段介绍";
    expect(
      workflowTextTemplateSource(
        workflowTextTemplateBinding(source, variables),
        variables,
      ),
    ).toBe(source);
  });

  it("keeps unknown tokens as literal text", () => {
    expect(workflowTextTemplateBinding("{{missing:value}}", variables)).toEqual(
      {
        kind: "text",
        segments: [{ kind: "literal", text: "{{missing:value}}" }],
      },
    );
  });

  it("inserts a token at the current text selection", () => {
    expect(
      insertWorkflowVariableToken("生成描述", variables[0]!.id, 2, 2),
    ).toEqual({
      source: "生成{{input:product_name}}描述",
      cursor: 24,
    });
  });

  it("binds equal field keys to their source node identity", () => {
    expect(workflowVariableIdentity("node_a", "text")).not.toBe(
      workflowVariableIdentity("node_b", "text"),
    );
  });
});
