import type { WorkflowTopologyNodeV1 } from "@kanvas/contracts/workflow";
import { describe, expect, it } from "vitest";

import {
  inspectWorkflowValueTemplate,
  probeWorkflowValueTemplate,
  resolveWorkflowValueTemplate,
  selectWorkflowSwitchTargets,
  WorkflowValueProtocolError,
} from "../src/modules/workflow/index.js";

function context(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    workflowInput: {
      source: {
        id: "asset-1",
      },
    },
    currentScopeKey: "root",
    getNodeResult(nodeKey: string, scopeKey: string) {
      if (nodeKey === "prepare" && scopeKey === "root") {
        return {
          status: "completed" as const,
          output: {
            items: [{ id: "item-1" }],
          },
        };
      }
      if (nodeKey === "optional" && scopeKey === "root") {
        return {
          status: "failed" as const,
          error: {
            code: "provider.failed",
          },
        };
      }
      return undefined;
    },
    ...overrides,
  };
}

describe("workflow value protocol", () => {
  it("resolves tagged references while leaving ordinary strings literal", () => {
    const result = resolveWorkflowValueTemplate(
      {
        sourceId: {
          $value: {
            source: "workflow_input",
            pointer: "/source/id",
          },
        },
        previous: {
          $value: {
            source: "node_output",
            nodeKey: "prepare",
            scope: "root",
            pointer: "/items/0/id",
          },
        },
        ordinary: "{{workflow_input.source.id}}",
      },
      context(),
    );

    expect(result).toEqual({
      ordinary: "{{workflow_input.source.id}}",
      previous: "item-1",
      sourceId: "asset-1",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("renders bounded string templates with scalar upstream values", () => {
    expect(
      resolveWorkflowValueTemplate(
        {
          $string: [
            "Asset ",
            {
              $value: {
                source: "workflow_input",
                pointer: "/source/id",
              },
            },
            " is ready",
          ],
        },
        context(),
      ),
    ).toBe("Asset asset-1 is ready");
    expect(
      inspectWorkflowValueTemplate({
        $string: [
          "Asset ",
          {
            $value: {
              source: "workflow_input",
              pointer: "/source/id",
            },
          },
        ],
      }).references,
    ).toHaveLength(1);
  });

  it("selects the available result from mutually exclusive branches", () => {
    const template = {
      $coalesce: [
        {
          $value: {
            source: "node_output" as const,
            nodeKey: "generate",
            scope: "root" as const,
            pointer: "/imageArtifactId",
          },
        },
        {
          $value: {
            source: "node_output" as const,
            nodeKey: "edit",
            scope: "root" as const,
            pointer: "/imageArtifactId",
          },
        },
      ],
    };
    expect(
      resolveWorkflowValueTemplate(
        template,
        context({
          getNodeResult(nodeKey: string) {
            return nodeKey === "generate"
              ? { status: "skipped" as const }
              : {
                  status: "completed" as const,
                  output: { imageArtifactId: "artifact-edited" },
                };
          },
        }),
      ),
    ).toBe("artifact-edited");
    expect(inspectWorkflowValueTemplate(template).references).toHaveLength(2);
  });

  it("fails when no branch result is available to coalesce", () => {
    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $coalesce: [
            {
              $value: {
                source: "node_output",
                nodeKey: "generate",
                scope: "root",
                pointer: "/imageArtifactId",
              },
            },
            {
              $value: {
                source: "node_output",
                nodeKey: "edit",
                scope: "root",
                pointer: "/imageArtifactId",
              },
            },
          ],
        },
        context({
          getNodeResult() {
            return { status: "skipped" as const };
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "source_unavailable" }));
  });

  it("rejects structured values inside a string template", () => {
    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $string: [
            {
              $value: {
                source: "workflow_input",
                pointer: "/source",
              },
            },
          ],
        },
        context(),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_template" }));
  });

  it("exposes only the bounded terminal result envelope", () => {
    expect(
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "node_result",
            nodeKey: "optional",
            scope: "root",
            pointer: "/error/code",
          },
        },
        context(),
      ),
    ).toBe("provider.failed");

    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "node_output",
            nodeKey: "optional",
            scope: "root",
            pointer: "",
          },
        },
        context(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "node_not_completed",
      }),
    );
  });

  it("treats a missing direct pointer as an explicit probe result", () => {
    expect(
      probeWorkflowValueTemplate(
        {
          $value: {
            source: "workflow_input",
            pointer: "/missing",
          },
        },
        context(),
      ),
    ).toEqual({ found: false });

    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "workflow_input",
            pointer: "/missing",
          },
        },
        context(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "pointer_not_found",
      }),
    );
  });

  it("requires map_item and current scope to exist in their runtime scope", () => {
    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "map_item",
            pointer: "/id",
          },
        },
        context(),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "map_item_unavailable",
      }),
    );

    expect(
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "map_item",
            pointer: "/id",
          },
        },
        context({
          currentScopeKey: "item:item-1",
          mapItem: {
            id: "item-1",
          },
        }),
      ),
    ).toBe("item-1");
  });

  it("rejects tag collisions, invalid pointers and non-JSON graphs", () => {
    expect(() =>
      inspectWorkflowValueTemplate({
        $value: {
          source: "workflow_input",
          pointer: "",
        },
        injected: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_template",
      }),
    );

    expect(() =>
      inspectWorkflowValueTemplate({
        $value: {
          source: "workflow_input",
          pointer: "/bad~2escape",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_pointer",
      }),
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => inspectWorkflowValueTemplate(cyclic)).toThrowError(
      expect.objectContaining({
        code: "invalid_json",
      }),
    );
  });

  it("never executes accessors while traversing workflow data", () => {
    let invoked = false;
    const workflowInput = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        invoked = true;
        return "leaked";
      },
    });

    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "workflow_input",
            pointer: "/secret",
          },
        },
        context({
          workflowInput,
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_json",
      }),
    );
    expect(invoked).toBe(false);

    const accessorArray = ["safe"];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return "leaked";
      },
    });
    expect(() =>
      resolveWorkflowValueTemplate(
        {
          $value: {
            source: "workflow_input",
            pointer: "/0",
          },
        },
        context({
          workflowInput: accessorArray,
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_json",
      }),
    );
    expect(invoked).toBe(false);
  });

  it("shares one resolution budget across repeated references", () => {
    const largeInput = Array.from({ length: 11_000 }, (_, index) => index);

    expect(() =>
      resolveWorkflowValueTemplate(
        {
          first: {
            $value: {
              source: "workflow_input",
              pointer: "",
            },
          },
          second: {
            $value: {
              source: "workflow_input",
              pointer: "",
            },
          },
        },
        context({
          workflowInput: largeInput,
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "bounds_exceeded",
      }),
    );
  });

  it("selects the first matching switch case without coercion", () => {
    const node = {
      key: "branch",
      kind: "switch",
      value: {
        $value: {
          source: "workflow_input",
          pointer: "/choice",
        },
      },
      cases: [
        {
          when: {
            operator: "equals",
            value: 1,
          },
          next: ["number_branch"],
        },
        {
          when: {
            operator: "equals",
            value: "1",
          },
          next: ["string_branch"],
        },
      ],
      defaultNext: ["default_branch"],
    } satisfies Extract<WorkflowTopologyNodeV1, { readonly kind: "switch" }>;

    expect(
      selectWorkflowSwitchTargets(node, {
        found: true,
        value: "1",
      }),
    ).toEqual({
      caseIndex: 1,
      next: ["string_branch"],
    });
    expect(() =>
      selectWorkflowSwitchTargets(node, { found: false }),
    ).toThrowError(WorkflowValueProtocolError);
  });

  it("permits missing values only when the switch declares exists handling", () => {
    const node = {
      key: "branch",
      kind: "switch",
      value: null,
      cases: [
        {
          when: {
            operator: "exists",
          },
          next: ["present"],
        },
      ],
      defaultNext: ["missing"],
    } satisfies Extract<WorkflowTopologyNodeV1, { readonly kind: "switch" }>;

    expect(
      selectWorkflowSwitchTargets(node, {
        found: false,
      }),
    ).toEqual({
      caseIndex: null,
      next: ["missing"],
    });
  });
});
