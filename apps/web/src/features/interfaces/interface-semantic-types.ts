export type InterfaceFieldType =
  "string" | "number" | "integer" | "boolean" | "object" | "array" | "enum";

const genericSemanticTypes = Object.freeze(["value.any"] as const);
const semanticTypesByFieldType: Readonly<
  Record<InterfaceFieldType, readonly string[]>
> = Object.freeze({
  string: Object.freeze([
    "text.plain",
    "prompt.rich",
    "artifact.image",
    "artifact.file",
    ...genericSemanticTypes,
  ]),
  enum: Object.freeze(["text.plain", ...genericSemanticTypes]),
  number: Object.freeze(["number.scalar", ...genericSemanticTypes]),
  integer: Object.freeze(["number.scalar", ...genericSemanticTypes]),
  boolean: Object.freeze(["boolean.flag", ...genericSemanticTypes]),
  object: Object.freeze([
    "value.object",
    "quality.signals",
    "canvas.geometry",
    ...genericSemanticTypes,
  ]),
  array: Object.freeze([
    "value.list",
    "artifact.image_list",
    "region.list",
    "tensor.image.rgb",
    "tensor.mask.alpha",
    ...genericSemanticTypes,
  ]),
});

export function interfaceSemanticTypes(
  fieldType: InterfaceFieldType,
): readonly string[] {
  return semanticTypesByFieldType[fieldType];
}

export function defaultInterfaceSemanticType(
  fieldType: InterfaceFieldType,
): string {
  return semanticTypesByFieldType[fieldType][0]!;
}

export function compatibleInterfaceSemanticType(
  fieldType: InterfaceFieldType,
  current: string,
): string {
  return semanticTypesByFieldType[fieldType].includes(current)
    ? current
    : defaultInterfaceSemanticType(fieldType);
}
