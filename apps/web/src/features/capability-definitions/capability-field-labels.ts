const semanticLabels: Readonly<
  Record<string, Readonly<{ zh: string; en: string }>>
> = {
  "artifact.image": { zh: "图片", en: "Image" },
  "artifact.image_list": { zh: "图片", en: "Images" },
  "artifact.mask": { zh: "蒙版", en: "Mask" },
  "artifact.foreground": { zh: "主体图片", en: "Foreground image" },
  "prompt.rich": { zh: "提示词", en: "Prompt" },
  "text.plain": { zh: "文本", en: "Text" },
  "quality.signals": { zh: "质量信息", en: "Quality details" },
};

const fieldLabels: Readonly<
  Record<string, Readonly<{ zh: string; en: string }>>
> = {
  sourceArtifactId: { zh: "原图", en: "Source image" },
  imageArtifactId: { zh: "结果图片", en: "Result image" },
  imageArtifactIds: { zh: "结果图片集", en: "Result images" },
  maskArtifactId: { zh: "蒙版", en: "Mask" },
  seed: { zh: "随机种子", en: "Seed" },
  size: { zh: "图片尺寸", en: "Image size" },
  prompt: { zh: "提示词", en: "Prompt" },
  quality: { zh: "质量", en: "Quality" },
  background: { zh: "背景", en: "Background" },
  resolution: { zh: "分辨率", en: "Resolution" },
  aspectRatio: { zh: "宽高比", en: "Aspect ratio" },
  outputFormat: { zh: "输出格式", en: "Output format" },
  numberOfImages: { zh: "图片数量", en: "Number of images" },
  outputCompression: { zh: "压缩质量", en: "Compression quality" },
  referenceArtifactIds: { zh: "参考图片", en: "Reference images" },
};

export function humanizeCapabilityField(key: string): string {
  const value = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ")
    .trim();
  return value ? value[0]!.toUpperCase() + value.slice(1) : key;
}

export type CapabilityFieldLabel = Readonly<{
  "zh-CN": string;
  "en-US": string;
}>;

/** Defaults fill missing metadata; saved declaration labels never pass through here. */
export function defaultCapabilityFieldLabel(
  key: string,
  schema: Readonly<Record<string, unknown>> = {},
): CapabilityFieldLabel {
  const title = typeof schema.title === "string" ? schema.title.trim() : "";
  const identifierTitle =
    !/\s/u.test(title) &&
    (/[_.:/]|[a-z\d][A-Z]/u.test(title) ||
      /^[a-z\d]+(?:-[a-z\d]+)+$/u.test(title));
  const readableTitle =
    title && title !== key && title.length <= 1_000 && !identifierTitle;
  if (readableTitle) return { "zh-CN": title, "en-US": title };
  const semantic = schema["x-kanvas-semantic-type"];
  const known =
    fieldLabels[key] ??
    (typeof semantic === "string" ? semanticLabels[semantic] : undefined);
  const fallback = humanizeCapabilityField(key);
  return { "zh-CN": known?.zh ?? fallback, "en-US": known?.en ?? fallback };
}

/** Distinguish automatic names without hiding fields or changing their keys. */
export function distinctCapabilityFieldLabels<
  T extends { readonly key: string; readonly label: CapabilityFieldLabel },
>(fields: readonly T[]): T[] {
  return fields.map((field) => {
    const label = { ...field.label };
    for (const locale of ["zh-CN", "en-US"] as const) {
      if (
        fields.some(
          (other) =>
            other.key !== field.key &&
            other.label[locale] === field.label[locale],
        )
      ) {
        const suffix = ` (${humanizeCapabilityField(field.key)})`;
        label[locale] =
          `${field.label[locale].slice(0, 1_000 - suffix.length)}${suffix}`;
      }
    }
    return { ...field, label };
  });
}
