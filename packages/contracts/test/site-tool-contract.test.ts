import { SiteToolMutationHeadersSchema } from "../src/api/site-tool-routes.js";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CreateSiteToolBodySchema,
  ToolCatalogueItemSchema,
} from "../src/api/site-tools.js";

const id = "01K00000000000000000000001";
const item = {
  id,
  slug: "calculator",
  displayName: "计算器",
  logoImageId: null,
  coverImageId: null,
};

describe("site tool consumer and management contracts", () => {
  it("carries semantic emoji and icon colors into consumer results", () => {
    expect(
      Value.Check(ToolCatalogueItemSchema, {
        ...item,
        symbol: { kind: "emoji", value: "👩🏽‍💻", backgroundColor: "#EEF2FF" },
      }),
    ).toBe(true);
    expect(
      Value.Check(ToolCatalogueItemSchema, {
        ...item,
        symbol: {
          kind: "icon",
          value: "palette",
          backgroundColor: "#EEF2FF",
          foregroundColor: "#3048F5",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(ToolCatalogueItemSchema, {
        ...item,
        symbol: { kind: "icon", value: "unknown", backgroundColor: "#EEF2FF" },
      }),
    ).toBe(false);
  });
  it("does not require a Workspace for site maintenance headers", () => {
    expect(
      Value.Check(SiteToolMutationHeadersSchema, {
        "idempotency-key": "test-create",
        "x-kanvas-csrf": "a".repeat(43),
      }),
    ).toBe(true);
    expect(
      "x-kanvas-workspace-id" in SiteToolMutationHeadersSchema.properties,
    ).toBe(false);
  });
  it("keeps maintenance facts out of catalogue responses", () => {
    expect(Value.Check(ToolCatalogueItemSchema, item)).toBe(true);
    for (const field of [
      "draft",
      "maintainerName",
      "updatedAt",
      "version",
      "check",
      "workspaceId",
    ]) {
      expect(
        Value.Check(ToolCatalogueItemSchema, { ...item, [field]: "private" }),
      ).toBe(false);
    }
  });

  it("does not accept client-selected ownership or a maintenance role", () => {
    const body = {
      slug: item.slug,
      displayName: item.displayName,
      logoImageId: null,
      coverImageId: null,
      summary: "",
      descriptionMarkdown: "",
      category: "",
      tags: [],
    };
    expect(Value.Check(CreateSiteToolBodySchema, body)).toBe(true);
    for (const field of [
      "workspaceId",
      "instanceId",
      "ownerPrincipalId",
      "canManage",
      "canPublish",
    ]) {
      expect(
        Value.Check(CreateSiteToolBodySchema, { ...body, [field]: id }),
      ).toBe(false);
    }
  });
});
