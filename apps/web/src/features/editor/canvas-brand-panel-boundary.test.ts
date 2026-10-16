import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./canvas-brand-panel-v1.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("./canvas-workspace-v1.tsx", import.meta.url),
  "utf8",
);

describe("Canvas Brand panel visual system", () => {
  it("shares Canvas panel sections and filled controls", () => {
    expect(source).toContain("CanvasPanelSection");
    expect(source).toContain("KanvasSelect");
    expect(source).toContain("StatusTag");
  });

  it("uses high-contrast borderless content actions and token surfaces", () => {
    expect(source).toContain("border-0 bg-[var(--paper)]");
    expect(source).toContain("var(--shadow-section)");
    expect(source).not.toContain("border border-[var(--canvas-panel-line)]");
    expect(source).not.toContain("hover:-translate-y-px");
  });

  it("keeps internal revision numbers out of the panel", () => {
    expect(source).not.toContain("revision.data.revisionNumber");
    expect(source).not.toContain("latestRevision.revisionNumber");
    expect(source).toContain('t("brand.canvas.ready")');
  });

  it("surfaces the current brand as part of the Canvas document header", () => {
    expect(workspaceSource).toContain('t("brand.canvas.openBrandTools"');
    expect(workspaceSource).toContain("brand?.name");
    expect(workspaceSource).toContain('handleActivePanelChange("brand")');
  });

  it("does not silently project the Workspace default into an unbranded Canvas", () => {
    expect(source).not.toContain("fetchDefaultBrandKitRevision");
    expect(source).toContain("if (!brand)");
    expect(source).toContain('t("brand.canvas.chooseBrand")');
  });
});
