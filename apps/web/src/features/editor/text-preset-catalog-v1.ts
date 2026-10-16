import type {
  EditorCatalogReferenceV1,
  EditorPaintV1,
  EditorTextEffectV1,
} from "@kanvas/contracts/editor";

export type CanvasTextPresetCategoryV1 =
  "curve" | "display" | "glow" | "label" | "shadow";

export interface CanvasTextPresetV1 {
  readonly category: CanvasTextPresetCategoryV1;
  readonly effects: readonly EditorTextEffectV1[];
  readonly fill: EditorPaintV1;
  readonly fontId: string;
  readonly fontRevision: string;
  readonly fontWeight: number;
  readonly id: string;
  readonly label: string;
  readonly letterSpacing: number;
  readonly revision: string;
}

const revision = "2026-07-31";
const fontRevision = "google-fonts-2026-07-31";

function preset(
  value: Omit<CanvasTextPresetV1, "fontRevision" | "revision">,
): CanvasTextPresetV1 {
  return {
    ...value,
    fontRevision,
    revision,
  };
}

export const canvasTextPresetCatalogV1 = [
  preset({
    id: "text.outline-bold",
    label: "醒目描边",
    category: "display",
    fontId: "noto-sans-sc",
    fontWeight: 900,
    letterSpacing: 2,
    fill: {
      kind: "solid",
      color: "#ffffff",
    },
    effects: [
      {
        kind: "outline",
        color: "#151515",
        width: 8,
      },
    ],
  }),
  preset({
    id: "text.lift",
    label: "立体浮起",
    category: "shadow",
    fontId: "noto-sans-sc",
    fontWeight: 900,
    letterSpacing: 1,
    fill: {
      kind: "solid",
      color: "#ffffff",
    },
    effects: [
      {
        kind: "shadow",
        color: "#151515",
        blur: 0,
        offsetX: 10,
        offsetY: 12,
        opacity: 0.9,
      },
    ],
  }),
  preset({
    id: "text.neon",
    label: "霓虹发光",
    category: "glow",
    fontId: "zcool-qingke-huangyou",
    fontWeight: 400,
    letterSpacing: 4,
    fill: {
      kind: "solid",
      color: "#ffffff",
    },
    effects: [
      {
        kind: "outline",
        color: "#f000ff",
        width: 3,
      },
      {
        kind: "glow",
        color: "#6c2cff",
        blur: 28,
        opacity: 0.95,
      },
    ],
  }),
  preset({
    id: "text.hollow",
    label: "镂空字",
    category: "display",
    fontId: "noto-sans-sc",
    fontWeight: 900,
    letterSpacing: 2,
    fill: {
      kind: "none",
    },
    effects: [
      {
        kind: "hollow",
        color: "#151515",
        width: 5,
      },
    ],
  }),
  preset({
    id: "text.glitch",
    label: "故障错位",
    category: "display",
    fontId: "oswald",
    fontWeight: 700,
    letterSpacing: 3,
    fill: {
      kind: "solid",
      color: "#ffffff",
    },
    effects: [
      {
        kind: "offset_layers",
        layers: [
          {
            color: "#ff2f70",
            offsetX: -7,
            offsetY: 0,
            opacity: 0.9,
          },
          {
            color: "#24d7ff",
            offsetX: 7,
            offsetY: 0,
            opacity: 0.9,
          },
        ],
      },
    ],
  }),
  preset({
    id: "text.sticker",
    label: "贴纸标题",
    category: "label",
    fontId: "zcool-kuaile",
    fontWeight: 400,
    letterSpacing: 1,
    fill: {
      kind: "solid",
      color: "#151515",
    },
    effects: [
      {
        kind: "background",
        paint: {
          kind: "solid",
          color: "#fff36a",
        },
        paddingX: 24,
        paddingY: 14,
        cornerRadius: 18,
      },
      {
        kind: "outline",
        color: "#ffffff",
        width: 8,
      },
      {
        kind: "shadow",
        color: "#151515",
        blur: 0,
        offsetX: 7,
        offsetY: 8,
        opacity: 0.85,
      },
    ],
  }),
  preset({
    id: "text.retro-shadow",
    label: "复古叠影",
    category: "shadow",
    fontId: "abril-fatface",
    fontWeight: 400,
    letterSpacing: 1,
    fill: {
      kind: "solid",
      color: "#f6d86b",
    },
    effects: [
      {
        kind: "offset_layers",
        layers: [
          {
            color: "#ef684e",
            offsetX: 6,
            offsetY: 6,
            opacity: 1,
          },
          {
            color: "#24405b",
            offsetX: 12,
            offsetY: 12,
            opacity: 1,
          },
        ],
      },
    ],
  }),
  preset({
    id: "text.curve-up",
    label: "向上弯曲",
    category: "curve",
    fontId: "noto-sans-sc",
    fontWeight: 800,
    letterSpacing: 3,
    fill: {
      kind: "solid",
      color: "#151515",
    },
    effects: [
      {
        kind: "curve",
        amount: 0.45,
      },
    ],
  }),
  preset({
    id: "text.curve-down",
    label: "向下弯曲",
    category: "curve",
    fontId: "noto-sans-sc",
    fontWeight: 800,
    letterSpacing: 3,
    fill: {
      kind: "solid",
      color: "#151515",
    },
    effects: [
      {
        kind: "curve",
        amount: -0.45,
      },
    ],
  }),
  preset({
    id: "text.dynamic-skew",
    label: "动感斜切",
    category: "display",
    fontId: "anton",
    fontWeight: 400,
    letterSpacing: 1,
    fill: {
      kind: "solid",
      color: "#3048f5",
    },
    effects: [
      {
        kind: "skew",
        x: -12,
        y: 0,
      },
      {
        kind: "shadow",
        color: "#ff2f70",
        blur: 0,
        offsetX: 9,
        offsetY: 8,
        opacity: 1,
      },
    ],
  }),
] as const satisfies readonly CanvasTextPresetV1[];

const definitions = new Map(
  canvasTextPresetCatalogV1.map((definition) => [definition.id, definition]),
);

export function canvasTextPresetReferenceV1(
  id: string,
): EditorCatalogReferenceV1 {
  const definition = definitions.get(id);
  if (!definition) {
    throw new Error(`Text preset ${id} is not loaded.`);
  }
  return {
    catalogId: "kanvas.core.text-presets",
    definitionId: definition.id,
    revision: definition.revision,
  };
}

export function canvasTextPresetV1(
  reference: EditorCatalogReferenceV1,
): CanvasTextPresetV1 {
  if (reference.catalogId !== "kanvas.core.text-presets") {
    throw new Error(
      `Text preset catalog ${reference.catalogId} is not loaded.`,
    );
  }
  const definition = definitions.get(reference.definitionId);
  if (!definition || definition.revision !== reference.revision) {
    throw new Error(
      `Text preset ${reference.definitionId}@${reference.revision} is not loaded.`,
    );
  }
  return definition;
}
