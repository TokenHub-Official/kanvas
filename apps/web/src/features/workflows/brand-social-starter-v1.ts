import type { BrandKitRevision } from "@kanvas/contracts/api";

import type { EffectiveInvocationValues } from "./effective-invocation-input.js";

export const brandSocialStarterWorkflowKeyV1 = "brand_social_starter";
const HEX_RGB_LENGTH = 7;
const HEADLINE_MAX_LENGTH = 120;

function opaqueHex(value: string): string {
  return value.length === HEX_RGB_LENGTH ? `${value}FF` : value;
}

export function brandSocialStarterDefaultsV1(
  revision: BrandKitRevision | undefined,
): EffectiveInvocationValues {
  if (!revision) return {};
  const logo =
    revision.logos.find((item) => item.role === "primary") ?? revision.logos[0];
  const color =
    revision.colors.find((item) => item.role === "primary") ??
    revision.colors.find((item) => item.role === "background") ??
    revision.colors[0];
  return {
    ...(logo ? { logoArtifactId: logo.artifactId } : {}),
    ...(color ? { backgroundColor: opaqueHex(color.value) } : {}),
  };
}

export function brandSocialStarterTitleStyleV1(
  revision: BrandKitRevision | undefined,
) {
  if (!revision) return undefined;
  return (
    revision.textStyles.find((item) => item.role === "title") ??
    revision.textStyles.find((item) => item.role === "display") ??
    revision.textStyles[0]
  );
}

export function brandSocialStarterHeadlineV1(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const value = (input as Readonly<Record<string, unknown>>).headline;
  return typeof value === "string"
    ? value.trim().slice(0, HEADLINE_MAX_LENGTH)
    : "";
}

export function brandSocialStarterBackgroundColorV1(
  input: unknown,
): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Readonly<Record<string, unknown>>).backgroundColor;
  return typeof value === "string" && /^#[0-9A-Fa-f]{8}$/u.test(value)
    ? value
    : undefined;
}

export function brandSocialStarterCanvasSizeV1(output: unknown): {
  readonly height: number;
  readonly width: number;
} {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { width: 1080, height: 1080 };
  }
  const canvas = (output as Readonly<Record<string, unknown>>).canvas;
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) {
    return { width: 1080, height: 1080 };
  }
  const { width, height } = canvas as Readonly<Record<string, unknown>>;
  return typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : { width: 1080, height: 1080 };
}
