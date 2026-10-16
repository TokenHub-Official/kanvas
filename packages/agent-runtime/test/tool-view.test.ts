import type { JSONSchema7 } from "json-schema";
import { describe, expect, it, vi } from "vitest";

import { createKanvasMastraTools } from "../src/tool-view.js";

const searchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 120 },
  },
} as const satisfies JSONSchema7;

describe("createKanvasMastraTools", () => {
  it("projects a bounded schema and delegates execution to the canonical executor", async () => {
    const executeCanonical = vi.fn((input: unknown) =>
      Promise.resolve({
        received: input,
        internalTrace: "hidden",
      }),
    );
    const tools = createKanvasMastraTools([
      {
        key: "asset.search",
        description: "Search eligible workspace assets for the current task.",
        inputSchema: searchSchema,
        effect: "read",
        approvalMode: "none",
        executeCanonical,
        toModelOutput: (output) => ({
          received: (output as { readonly received: unknown }).received,
        }),
      },
    ]);

    const tool = tools["asset.search"];
    expect(tool).toBeDefined();
    expect(tool?.requireApproval).toBe(false);
    const projectedSchema = tool?.inputSchema?.["~standard"].jsonSchema.input({
      target: "draft-07",
    });
    expect(projectedSchema).toMatchObject(searchSchema);
    expect(projectedSchema?.$schema).toBe(
      "http://json-schema.org/draft-07/schema#",
    );

    const result = await tool?.execute?.(
      { query: "summer product" },
      {} as never,
    );
    expect(result).toEqual({
      received: { query: "summer product" },
      internalTrace: "hidden",
    });
    expect(executeCanonical).toHaveBeenCalledOnce();
    expect(tool?.toModelOutput?.(result)).toEqual({
      received: { query: "summer product" },
    });
  });

  it("maps before-call approval without treating before-commit as pre-call approval", () => {
    const tools = createKanvasMastraTools([
      {
        key: "workflow.start",
        description:
          "Start the confirmed production workflow for this request.",
        inputSchema: searchSchema,
        effect: "internal-write",
        approvalMode: "before-call",
        executeCanonical: () => Promise.resolve({ started: true }),
      },
      {
        key: "canvas.preview-change",
        description: "Prepare a reversible canvas change preview for review.",
        inputSchema: searchSchema,
        effect: "internal-write",
        approvalMode: "before-commit",
        executeCanonical: () => Promise.resolve({ preview: true }),
      },
    ]);

    expect(tools["workflow.start"]?.requireApproval).toBe(true);
    expect(tools["canvas.preview-change"]?.requireApproval).toBe(false);
  });

  it("rejects server-owned fields and unapproved high-risk tools", () => {
    expect(() =>
      createKanvasMastraTools([
        {
          key: "provider.invoke",
          description:
            "Invoke an external provider with a selected credential.",
          inputSchema: {
            type: "object",
            properties: { credentialId: { type: "string" } },
          },
          effect: "external-write",
          approvalMode: "before-call",
          executeCanonical: () => Promise.resolve({}),
        },
      ]),
    ).toThrow(/server-owned field credentialId/u);

    expect(() =>
      createKanvasMastraTools([
        {
          key: "asset.delete",
          description: "Permanently delete a selected workspace asset.",
          inputSchema: searchSchema,
          effect: "destructive",
          approvalMode: "none",
          executeCanonical: () => Promise.resolve({}),
        },
      ]),
    ).toThrow(/requires an explicit approval mode/u);
  });
});
