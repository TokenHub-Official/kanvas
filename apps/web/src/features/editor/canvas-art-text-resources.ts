import type { ResourceAdoptionResult } from "@kanvas/contracts/api";
import type {
  ResourceArtTextCandidate,
  ResourceFontCandidate,
  WorkspaceArtTextPreset,
} from "@kanvas/contracts/resource-source";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchWorkspaceArtTextCatalog } from "../../api/transport.js";
import type { CanvasTextInsertionOptionsV1 } from "./canvas-insertion-commands-v1.js";
import type { CanvasFontDefinitionV1 } from "./font-catalog-v1.js";
import type { CanvasTextStyleSnapshotV1 } from "./canvas-text-style-v1.js";

const regularFontWeight = 400;
const preferredArtTextFontWeight = 700;

export interface CanvasWorkspaceArtTextPresetV1 {
  readonly id: string;
  readonly label: string;
  readonly style: CanvasTextStyleSnapshotV1;
}

function presetLabel(preset: WorkspaceArtTextPreset, language: string): string {
  const labels = preset.manifest.labels;
  const normalized = language.toLowerCase();
  const base = normalized.split("-")[0] ?? normalized;
  return (
    Object.entries(labels).find(
      ([key]) => key.toLowerCase() === normalized,
    )?.[1] ??
    Object.entries(labels).find(
      ([key]) => key.toLowerCase().split("-")[0] === base,
    )?.[1] ??
    labels["en"] ??
    Object.values(labels)[0] ??
    preset.manifest.id
  );
}

function presetFont(
  preset: WorkspaceArtTextPreset,
  fonts: readonly CanvasFontDefinitionV1[],
): CanvasFontDefinitionV1 {
  const requirements = preset.manifest.fontRequirements;
  const fallbackCategory =
    requirements.fallbackCategory === "monospace"
      ? "sans"
      : requirements.fallbackCategory;
  const preferred = requirements.preferredFontRevisionId
    ? fonts.find((font) => font.id === requirements.preferredFontRevisionId)
    : undefined;
  if (preferred) return preferred;

  const scripted = fonts.find(
    (font) =>
      font.category === fallbackCategory &&
      requirements.requiredScripts.every((script) =>
        font.scripts?.includes(script),
      ),
  );
  return (
    scripted ??
    fonts.find((font) => font.category === fallbackCategory) ??
    fonts[0]!
  );
}

export function workspaceCanvasArtTextPresetsV1(
  presets: readonly WorkspaceArtTextPreset[],
  fonts: readonly CanvasFontDefinitionV1[],
  language: string,
): readonly CanvasWorkspaceArtTextPresetV1[] {
  if (fonts.length === 0) return [];
  return presets.map((preset) => {
    const font = presetFont(preset, fonts);
    const fontWeight = font.weights.includes(preferredArtTextFontWeight)
      ? preferredArtTextFontWeight
      : (font.weights.at(-1) ?? regularFontWeight);
    return {
      id: preset.id,
      label: presetLabel(preset, language),
      style: {
        align: preset.manifest.alignment,
        decoration: { strikeThrough: false, underline: false },
        effects: preset.manifest.effects,
        fill: preset.manifest.fill,
        font: {
          family: font.family,
          fontId: font.id,
          revision: font.revision,
          source: font.source,
        },
        fontSize: 64,
        fontStyle: "normal",
        fontWeight,
        letterSpacing: preset.manifest.letterSpacing,
        lineHeight: preset.manifest.lineHeight,
        spaceAfter: 0,
        spaceBefore: 0,
        verticalAlign: "middle",
      },
    };
  });
}

export function canvasExternalTextInsertionOptionsV1(
  result: ResourceAdoptionResult,
  candidate: ResourceArtTextCandidate | ResourceFontCandidate,
  fonts: readonly CanvasFontDefinitionV1[],
  language: string,
): CanvasTextInsertionOptionsV1 | undefined {
  if (candidate.kind === "font" && result.kind === "font_revision") {
    return {
      editImmediately: true,
      text: candidate.family,
      font: {
        family: candidate.family,
        fontId: result.fontRevisionId,
        revision: result.fontRevisionId,
        source: "workspace",
      },
    };
  }
  if (
    candidate.kind !== "art_text" ||
    result.kind !== "art_text_preset_revision"
  ) {
    return undefined;
  }
  const preset = workspaceCanvasArtTextPresetsV1(
    [
      {
        id: result.artTextPresetRevisionId,
        manifest: candidate.manifest,
        createdAt: new Date(0).toISOString(),
      },
    ],
    fonts,
    language,
  )[0];
  return preset
    ? { editImmediately: true, text: preset.label, style: preset.style }
    : undefined;
}

export function useCanvasArtTextResources(
  workspaceId: string,
  fonts: readonly CanvasFontDefinitionV1[],
  language: string,
): readonly CanvasWorkspaceArtTextPresetV1[] {
  const catalog = useQuery({
    queryKey: ["workspace-art-text-catalog", workspaceId],
    queryFn: () => fetchWorkspaceArtTextCatalog(workspaceId),
    retry: false,
  });
  return useMemo(
    () =>
      workspaceCanvasArtTextPresetsV1(
        catalog.data?.presets ?? [],
        fonts,
        language,
      ),
    [catalog.data?.presets, fonts, language],
  );
}
