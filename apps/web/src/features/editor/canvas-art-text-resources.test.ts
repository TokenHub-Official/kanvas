import type {
  ResourceArtTextCandidate,
  ResourceFontCandidate,
  WorkspaceArtTextPreset,
} from "@kanvas/contracts/resource-source";
import { describe, expect, it } from "vitest";

import {
  canvasExternalTextInsertionOptionsV1,
  workspaceCanvasArtTextPresetsV1,
} from "./canvas-art-text-resources.js";
import type { CanvasFontDefinitionV1 } from "./font-catalog-v1.js";

const font: CanvasFontDefinitionV1 = {
  category: "display",
  family: "Example Display",
  id: "01J00000000000000000000001",
  label: "Example Display",
  languages: ["zh-Hans", "en"],
  license: "OFL-1.1",
  revision: "01J00000000000000000000001",
  scripts: ["Hans", "Latn"],
  source: "workspace",
  weights: [400, 700],
};

const preset = {
  id: "01J00000000000000000000002",
  manifest: {
    schemaVersion: 1,
    id: "poster-outline",
    revision:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    labels: { en: "Poster outline", "zh-Hans": "海报描边" },
    fontRequirements: {
      preferredFontRevisionId: font.id,
      requiredScripts: ["Hans"],
      fallbackCategory: "display",
    },
    fill: { kind: "solid", color: "#ffffff" },
    effects: [{ kind: "outline", color: "#151515", width: 6 }],
    letterSpacing: 2,
    lineHeight: 1.1,
    alignment: "center",
    editable: { text: true, font: true, colorSlots: [] },
    license: {
      licenseId: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
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
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  },
  createdAt: "2026-08-26T00:00:00.000Z",
} as const satisfies WorkspaceArtTextPreset;

describe("Canvas art text resources", () => {
  it("turns an adopted manifest into an editable workspace text style", () => {
    const [mapped] = workspaceCanvasArtTextPresetsV1([preset], [font], "zh-CN");

    expect(mapped).toMatchObject({
      label: "海报描边",
      style: {
        font: {
          fontId: font.id,
          revision: font.revision,
          source: "workspace",
        },
        fontWeight: 700,
        effects: preset.manifest.effects,
      },
    });
  });

  it("turns an external font adoption into an immediate canvas insertion", () => {
    const candidate = {
      kind: "font",
      family: "Example Display",
    } as ResourceFontCandidate;

    expect(
      canvasExternalTextInsertionOptionsV1(
        { kind: "font_revision", fontRevisionId: font.id },
        candidate,
        [font],
        "zh-CN",
      ),
    ).toEqual({
      editImmediately: true,
      text: "Example Display",
      font: {
        family: "Example Display",
        fontId: font.id,
        revision: font.id,
        source: "workspace",
      },
    });
  });

  it("turns an external art-text adoption into an immediate canvas insertion", () => {
    const candidate = {
      kind: "art_text",
      manifest: preset.manifest,
    } as unknown as ResourceArtTextCandidate;

    expect(
      canvasExternalTextInsertionOptionsV1(
        {
          kind: "art_text_preset_revision",
          artTextPresetRevisionId: preset.id,
        },
        candidate,
        [font],
        "zh-CN",
      ),
    ).toMatchObject({
      editImmediately: true,
      text: "海报描边",
      style: { font: { fontId: font.id }, effects: preset.manifest.effects },
    });
  });
});
