import type { WorkflowAuthoringVariableOptionV1 } from "./workflow-authoring-node-editor-v1.js";
import { describe, expect, it } from "vitest";

import {
  richPromptToWorkflowBinding,
  workflowBindingToRichPrompt,
  workflowSuggestionMatch,
} from "./workflow-rich-prompt-v1.js";

const variables: readonly WorkflowAuthoringVariableOptionV1[] = [
  {
    id: "node_a:text",
    label: "Text",
    sourceLabel: "Node A",
    sourceNodeId: "node_a",
    fieldKey: "text",
    schema: { type: "string" },
    variable: {
      source: "node_output",
      nodeKey: "node_a",
      scope: "root",
      path: ["text"],
    },
  },
];

describe("workflow rich prompt", () => {
  it("round-trips inline mention nodes with source node and field identity", () => {
    const binding = {
      kind: "text" as const,
      segments: [
        { kind: "literal" as const, text: "Reply: " },
        { kind: "variable" as const, variable: variables[0]!.variable },
      ],
    };
    const content = workflowBindingToRichPrompt(binding, variables);
    expect(content.content?.[0]?.content?.[1]?.attrs).toMatchObject({
      id: "node_a:text",
      sourceNodeId: "node_a",
      fieldKey: "text",
    });
    expect(richPromptToWorkflowBinding(content, variables)).toEqual(binding);
  });

  it("recognizes only the @ variable trigger", () => {
    const input = (text: string) => ({
      $position: { pos: text.length, nodeBefore: { isText: true, text } },
    });
    expect(workflowSuggestionMatch(input("hello @prod"))?.query).toBe("prod");
    expect(workflowSuggestionMatch(input("#mask"))).toBeNull();
    expect(workflowSuggestionMatch(input("{{image"))).toBeNull();
  });
});
