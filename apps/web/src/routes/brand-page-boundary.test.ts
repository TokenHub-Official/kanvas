import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./brand-page.tsx", import.meta.url),
  "utf8",
);

describe("Brand Center interaction boundaries", () => {
  it("keeps dense text-style controls stacked below desktop-wide layouts", () => {
    expect(source).toContain(
      "xl:grid-cols-[minmax(150px,1fr)_140px_190px_100px_100px_36px]",
    );
    expect(source).not.toContain(
      "md:grid-cols-[minmax(150px,1fr)_140px_190px_100px_100px_36px]",
    );
  });

  it("keeps save and publication state visible during long-page editing", () => {
    expect(source).toContain("sticky bottom-3");
    expect(source).toContain('statusKey === "savedUnpublished"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("!publishChanges");
  });

  it("lists the foundations still required beside the publish action", () => {
    expect(source).toContain(
      '...(logos.length === 0 ? [t("brand.logos")] : [])',
    );
    expect(source).toContain(
      '...(colors.length === 0 ? [t("brand.colors")] : [])',
    );
    expect(source).toContain(
      '...(textStyles.length === 0 ? [t("brand.textStyles")] : [])',
    );
    expect(source).toContain("new Intl.ListFormat");
    expect(source).toContain('t("brand.publishMissingRequirements"');
    expect(source).toContain("missingPublishRequirements.length > 0");
  });

  it("uses the same opaque work surfaces as Assets and Settings", () => {
    expect(source).toContain("max-w-320");
    expect(source).toContain("rounded-[20px] bg-paper");
    expect(source).toContain("bg-mist");
    expect(source).toContain("KanvasInput");
    expect(source).toContain("KanvasTextArea");
    expect(source).toContain("KanvasSelect");
    expect(source).toContain("StatusTag");
    expect(source).not.toContain("bg-paper/55");
    expect(source).not.toContain("bg-paper/60");
    expect(source).not.toContain("bg-paper/70");
  });

  it("keeps the user-facing brand list separate from the editor", () => {
    expect(source).toContain('"brand.manageBrand"');
    expect(source).toContain('t("brand.backToBrands")');
    expect(source).toContain('t("brand.available")');
    expect(source).toContain('window.scrollTo({ behavior: "auto", top: 0 })');
  });

  it("does not project raw errors or internal version numbers", () => {
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("item.revisionNumber");
    expect(source).not.toContain("selectedSummary.revisionNumber");
  });

  it("requires Agent permission before offering brand creation in a conversation", () => {
    expect(source).toContain("summary.latestPublishedRevision && canUseAgent");
    expect(source).toContain("{canUseAgent ? (");
  });

  it("returns Brand-sourced result Assets alongside Logo Assets", () => {
    expect(source).toContain(
      "asset.currentArtifact?.brand?.brandKitId === brandKitId",
    );
    expect(source).toContain('"brand.resultAsset"');
    expect(source).toContain('"brand.logoAsset"');
  });

  it("offers only Artifact types accepted by Brand logo persistence", () => {
    const picker = readFileSync(
      new URL("../features/brand/brand-logo-picker.tsx", import.meta.url),
      "utf8",
    );
    expect(picker).toContain(
      'asset.currentArtifact?.artifactType.startsWith("image.")',
    );
    expect(picker).toContain("fetchWorkspaceAsset(workspaceId, item.id)");
  });
});
