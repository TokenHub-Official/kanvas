import type { EditorTextContentV1 } from "@kanvas/contracts/editor";

type EditorFontSourceV1 =
  EditorTextContentV1["paragraphs"][number]["runs"][number]["font"]["source"];

export type CanvasFontCategoryV1 = "display" | "handwriting" | "sans" | "serif";

export interface CanvasFontDefinitionV1 {
  readonly category: CanvasFontCategoryV1;
  readonly family: string;
  readonly id: string;
  readonly label: string;
  readonly languages: readonly string[];
  readonly license: string;
  readonly revision: string;
  readonly scripts?: readonly string[];
  readonly source: Extract<EditorFontSourceV1, "builtin" | "workspace">;
  readonly weights: readonly number[];
}

const revision = "google-fonts-2026-07-31";

function font(
  value: Omit<CanvasFontDefinitionV1, "license" | "revision" | "source">,
): CanvasFontDefinitionV1 {
  return {
    ...value,
    source: "builtin",
    license: "OFL-1.1",
    revision,
  };
}

export const canvasFontCatalogV1 = [
  font({
    id: "noto-sans-sc",
    label: "思源黑体",
    family: "Noto Sans SC",
    languages: ["zh-Hans", "en"],
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "noto-serif-sc",
    label: "思源宋体",
    family: "Noto Serif SC",
    languages: ["zh-Hans", "en"],
    category: "serif",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "zcool-xiaowei",
    label: "站酷小薇体",
    family: "ZCOOL XiaoWei",
    languages: ["zh-Hans"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "zcool-qingke-huangyou",
    label: "站酷庆科黄油体",
    family: "ZCOOL QingKe HuangYou",
    languages: ["zh-Hans"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "zcool-kuaile",
    label: "站酷快乐体",
    family: "ZCOOL KuaiLe",
    languages: ["zh-Hans"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "ma-shan-zheng",
    label: "马善政毛笔楷书",
    family: "Ma Shan Zheng",
    languages: ["zh-Hans"],
    category: "handwriting",
    weights: [400],
  }),
  font({
    id: "long-cang",
    label: "龙藏体",
    family: "Long Cang",
    languages: ["zh-Hans"],
    category: "handwriting",
    weights: [400],
  }),
  font({
    id: "liu-jian-mao-cao",
    label: "刘建毛草",
    family: "Liu Jian Mao Cao",
    languages: ["zh-Hans"],
    category: "handwriting",
    weights: [400],
  }),
  font({
    id: "zhi-mang-xing",
    label: "志莽行书",
    family: "Zhi Mang Xing",
    languages: ["zh-Hans"],
    category: "handwriting",
    weights: [400],
  }),
  font({
    id: "montserrat",
    label: "Montserrat",
    family: "Montserrat",
    languages: ["en"],
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "poppins",
    label: "Poppins",
    family: "Poppins",
    languages: ["en"],
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "inter",
    label: "Inter",
    family: "Inter",
    languages: ["en"],
    category: "sans",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "dm-sans",
    label: "DM Sans",
    family: "DM Sans",
    languages: ["en"],
    category: "sans",
    weights: [400, 500, 600, 700],
  }),
  font({
    id: "space-grotesk",
    label: "Space Grotesk",
    family: "Space Grotesk",
    languages: ["en"],
    category: "sans",
    weights: [400, 500, 600, 700],
  }),
  font({
    id: "oswald",
    label: "Oswald",
    family: "Oswald",
    languages: ["en"],
    category: "display",
    weights: [400, 500, 600, 700],
  }),
  font({
    id: "bebas-neue",
    label: "Bebas Neue",
    family: "Bebas Neue",
    languages: ["en"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "anton",
    label: "Anton",
    family: "Anton",
    languages: ["en"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "abril-fatface",
    label: "Abril Fatface",
    family: "Abril Fatface",
    languages: ["en"],
    category: "display",
    weights: [400],
  }),
  font({
    id: "playfair-display",
    label: "Playfair Display",
    family: "Playfair Display",
    languages: ["en"],
    category: "serif",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "cormorant-garamond",
    label: "Cormorant Garamond",
    family: "Cormorant Garamond",
    languages: ["en"],
    category: "serif",
    weights: [400, 500, 600, 700],
  }),
  font({
    id: "cinzel",
    label: "Cinzel",
    family: "Cinzel",
    languages: ["en"],
    category: "serif",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "barlow-condensed",
    label: "Barlow Condensed",
    family: "Barlow Condensed",
    languages: ["en"],
    category: "display",
    weights: [400, 500, 600, 700, 800, 900],
  }),
  font({
    id: "pacifico",
    label: "Pacifico",
    family: "Pacifico",
    languages: ["en"],
    category: "handwriting",
    weights: [400],
  }),
  font({
    id: "lobster",
    label: "Lobster",
    family: "Lobster",
    languages: ["en"],
    category: "handwriting",
    weights: [400],
  }),
] as const satisfies readonly CanvasFontDefinitionV1[];

const definitions = new Map(
  canvasFontCatalogV1.map((definition) => [definition.id, definition]),
);

export function findCanvasFontDefinitionV1(
  idOrFamily: string,
): CanvasFontDefinitionV1 | undefined {
  return (
    definitions.get(idOrFamily) ??
    canvasFontCatalogV1.find((definition) => definition.family === idOrFamily)
  );
}

export function canvasFontDefinitionV1(
  id: string,
  fontRevision = revision,
): CanvasFontDefinitionV1 {
  const definition = definitions.get(id);
  if (!definition || definition.revision !== fontRevision) {
    throw new Error(`Font ${id}@${fontRevision} is not loaded.`);
  }
  return definition;
}

export function prioritizeCanvasFontsV1(
  fonts: readonly CanvasFontDefinitionV1[],
  language: string,
): readonly CanvasFontDefinitionV1[] {
  const normalized = language.toLowerCase();
  const preferred = normalized.startsWith("zh") ? "zh-Hans" : "en";
  return fonts
    .map((definition, index) => ({
      definition,
      index,
      priority: definition.languages.some(
        (candidate) =>
          candidate.toLowerCase() === preferred.toLowerCase() ||
          normalized.startsWith(candidate.toLowerCase()),
      )
        ? 0
        : 1,
    }))
    .toSorted((left, right) =>
      left.priority === right.priority
        ? left.index - right.index
        : left.priority - right.priority,
    )
    .map(({ definition }) => definition);
}
