import type {
  AgentActionReceiptRecord,
  BrandKitDocument,
  BrandKitRevisionRecord,
  BrandKitSummaryRecord,
  TrustedWorkspaceScope,
  WorkspaceBrandRepository,
} from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import { createAgentBrandResourceExecutor } from "../src/agent/brand-resource-executor.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-14T18:00:00.000Z");
const authority = {
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "brand-resource-test",
  authorityType: "human_membership",
  authorityId: id(4),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "brand.read"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

function document(name: string): BrandKitDocument {
  return {
    schemaVersion: 1,
    name,
    colors: [],
    logos: [],
    referenceImages: [],
    textStyles: [],
    guidelines: { principles: [`Keep ${name} recognizable.`], avoid: [] },
  };
}

function revision(options: {
  readonly id: string;
  readonly brandKitId: string;
  readonly revisionNumber: number;
  readonly name: string;
}): BrandKitRevisionRecord {
  return {
    id: options.id,
    brandKitId: options.brandKitId,
    workspaceId: authority.workspaceId,
    revisionNumber: options.revisionNumber,
    document: document(options.name),
    contentDigest: `sha256:${"a".repeat(64)}`,
    publishedByPrincipalId: authority.principalId,
    publishedAt: now,
  };
}

function summary(options: {
  readonly brandKitId: string;
  readonly revision?: BrandKitRevisionRecord;
  readonly name: string;
  readonly isDefault?: boolean;
}): BrandKitSummaryRecord {
  return {
    id: options.brandKitId,
    workspaceId: authority.workspaceId,
    name: options.name,
    lifecycleStatus: "active",
    isDefault: options.isDefault ?? false,
    version: 1,
    draftVersion: 7,
    ...(options.revision
      ? {
          latestPublishedRevision: {
            id: options.revision.id,
            revisionNumber: options.revision.revisionNumber,
            publishedAt: options.revision.publishedAt,
          },
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function harness() {
  const selected = revision({
    id: id(11),
    brandKitId: id(10),
    revisionNumber: 1,
    name: "Selected historical Brand",
  });
  const latest = revision({
    id: id(12),
    brandKitId: id(10),
    revisionNumber: 2,
    name: "Selected Brand latest",
  });
  const bound = revision({
    id: id(21),
    brandKitId: id(20),
    revisionNumber: 1,
    name: "Bound Brand",
  });
  const list = vi.fn<WorkspaceBrandRepository["list"]>(() =>
    Promise.resolve([
      summary({
        brandKitId: id(10),
        revision: latest,
        name: "Unpublished draft rename",
      }),
      summary({
        brandKitId: id(20),
        revision: bound,
        name: "Bound draft rename",
      }),
      summary({ brandKitId: id(30), name: "Draft only Brand" }),
    ]),
  );
  const getRevision = vi.fn<WorkspaceBrandRepository["getRevision"]>(
    (_authority, _brandKitId, revisionId) =>
      Promise.resolve(
        [selected, latest, bound].find((item) => item.id === revisionId),
      ),
  );
  const executeWithReceipt = vi.fn(
    async (
      _toolKey: string,
      _input: unknown,
      operation: (
        action: AgentActionReceiptRecord,
      ) => Promise<{ readonly modelOutput: unknown }>,
    ) => operation({} as AgentActionReceiptRecord),
  );
  const executor = createAgentBrandResourceExecutor({
    authority,
    brands: { list, getRevision },
    boundBrandKitIds: new Set([bound.brandKitId]),
    selectedBrandRevisionId: selected.id,
    now: () => now,
    executeWithReceipt,
  });
  return { executor, list, getRevision, selected, latest, bound };
}

describe("createAgentBrandResourceExecutor", () => {
  it("reports partial Brand results", async () => {
    const { executor, list, getRevision, selected } = harness();
    const revisions = Array.from({ length: 30 }, (_, index) =>
      revision({
        id: id(100 + index),
        brandKitId: id(200 + index),
        revisionNumber: 1,
        name: `Brand ${index}`,
      }),
    );
    list.mockResolvedValue(
      revisions.map((item) =>
        summary({
          brandKitId: item.brandKitId,
          revision: item,
          name: item.document.name,
        }),
      ),
    );
    getRevision.mockImplementation((_scope, _brandId, revisionId) =>
      Promise.resolve(
        [selected, ...revisions].find((item) => item.id === revisionId),
      ),
    );
    const result = await executor.search({});
    expect(result.modelOutput).toMatchObject({
      truncated: true,
      totalResults: 31,
    });
    expect((result.modelOutput as { brands: unknown[] }).brands).toHaveLength(
      20,
    );
  });

  it("returns only published revisions and prioritizes selected then bound Brands", async () => {
    const { executor, selected, latest, bound } = harness();
    const result = await executor.search({ query: "no exact match" });

    expect(result.modelOutput).toMatchObject({
      queryMatched: false,
      showingPublishedBrands: true,
      brands: [
        {
          brandKitRevisionId: selected.id,
          selectedForRun: true,
          boundToAgent: false,
        },
        {
          brandKitRevisionId: bound.id,
          selectedForRun: false,
          boundToAgent: true,
        },
        {
          brandKitRevisionId: latest.id,
          selectedForRun: false,
          boundToAgent: false,
        },
      ],
    });
    expect(JSON.stringify(result.modelOutput)).not.toContain("draftVersion");
    expect(JSON.stringify(result.modelOutput)).not.toContain(
      "Draft only Brand",
    );
    expect(JSON.stringify(result.modelOutput)).not.toContain("draft rename");

    const focused = await executor.search({ query: "Bound Brand" });
    expect(focused.modelOutput).toMatchObject({
      brands: [
        { brandKitRevisionId: selected.id },
        { brandKitRevisionId: bound.id },
      ],
    });
  });

  it("reads the exact published Revision without requesting its Draft", async () => {
    const { executor, getRevision, selected } = harness();
    const result = await executor.inspectPublished({
      brandKitRevisionId: selected.id,
    });

    expect(result.modelOutput).toMatchObject({
      brand: {
        brandKitRevisionId: selected.id,
        revisionNumber: 1,
        document: { name: "Selected historical Brand" },
        selectedForRun: true,
      },
    });
    expect(getRevision).toHaveBeenLastCalledWith(
      authority,
      undefined,
      selected.id,
      now,
    );
  });
});
