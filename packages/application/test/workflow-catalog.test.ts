import { describe, expect, it, vi } from "vitest";

import {
  authorizationModelVersion,
  createWorkflowCatalog,
  type TrustedWorkspaceScope,
  type WorkflowTemplate,
} from "../src/index.js";

const authority: TrustedWorkspaceScope = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion,
  effectivePermissions: ["workflow.read"],
  trusted: true,
};

const template = {
  workflowDefinitionId: "01K00000000000000000000006",
  workflowRevisionId: "01K00000000000000000000007",
  workflowKey: "technical_workflow_key",
  revision: 1,
  displayName: "Internal name",
  canonicalDigest: `sha256:${"a".repeat(64)}`,
  runtimeStatus: "enabled",
  topology: { schemaVersion: 1, key: "flow", nodes: [] },
  inputSchema: {},
  outputSchema: {},
  presentation: {
    schemaVersion: 1,
    title: "商品广告",
    description: "根据商品素材生成推广图片。",
    category: "营销创作",
    tags: ["电商", "广告"],
    availability: {
      standalone: true,
      canvas: true,
      directLink: true,
    },
  },
  publishedAt: new Date("2026-08-20T00:00:00.000Z"),
} as unknown as WorkflowTemplate;

describe("Workflow catalog presentation", () => {
  it("searches published presentation instead of technical workflow keys", async () => {
    const repository = {
      list: vi.fn(() => Promise.resolve([template])),
      get: vi.fn(() => Promise.resolve(template)),
    };
    const catalog = createWorkflowCatalog({
      repository,
      now: () => new Date(),
    });

    await expect(catalog.list(authority, { query: "电商" })).resolves.toEqual([
      template,
    ]);
    await expect(
      catalog.list(authority, { query: "technical_workflow_key" }),
    ).resolves.toEqual([]);
    await expect(
      catalog.list(authority, { category: "营销创作" }),
    ).resolves.toEqual([template]);
  });
});
