import { readFileSync } from "node:fs";

import type { WorkspaceFontRevision } from "@kanvas/contracts/resource-source";
import { describe, expect, it } from "vitest";

import { workspaceCanvasFontDefinitionsV1 } from "./canvas-font-resources.js";

const fontRevision: WorkspaceFontRevision = {
  id: "01J00000000000000000000001",
  family: "Example Sans",
  category: "sans",
  scripts: ["Latn"],
  languages: ["en"],
  license: {
    licenseId: "OFL-1.1",
    licenseUrl: "https://openfontlicense.org/",
    commercialUseAllowed: true,
    modificationAllowed: true,
    attributionRequired: false,
    shareAlikeRequired: false,
    standaloneRedistributionAllowed: true,
    modelReleaseStatus: "not_applicable",
    propertyReleaseStatus: "not_applicable",
    trademarkRisk: "none_declared",
    capturedAt: "2026-08-26T00:00:00.000Z",
    termsDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  files: [
    {
      artifactId: "01J00000000000000000000002",
      format: "ttf",
      weight: 400,
      style: "normal",
      subset: "latin",
    },
    {
      artifactId: "01J00000000000000000000003",
      format: "ttf",
      weight: 700,
      style: "normal",
      subset: "latin",
    },
  ],
  createdAt: "2026-08-26T00:00:00.000Z",
};

describe("canvas font resources", () => {
  it("maps adopted revisions to immutable workspace font definitions", () => {
    expect(workspaceCanvasFontDefinitionsV1([fontRevision])).toEqual([
      expect.objectContaining({
        id: fontRevision.id,
        revision: fontRevision.id,
        source: "workspace",
        weights: [400, 700],
      }),
    ]);
  });

  it("keeps the application shell free of direct font-provider requests", () => {
    const html = readFileSync(
      new URL("../../../index.html", import.meta.url),
      "utf8",
    );
    const runtime = readFileSync(
      new URL("./canvas-font-resources.ts", import.meta.url),
      "utf8",
    );

    expect(`${html}\n${runtime}`).not.toContain("fonts.googleapis.com");
    expect(`${html}\n${runtime}`).not.toContain("fonts.gstatic.com");
  });
});
