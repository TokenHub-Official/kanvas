import type { BrandKitRevision } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  brandSocialStarterCanvasSizeV1,
  brandSocialStarterBackgroundColorV1,
  brandSocialStarterDefaultsV1,
  brandSocialStarterHeadlineV1,
  brandSocialStarterTitleStyleV1,
} from "./brand-social-starter-v1.js";

const revision = {
  colors: [
    {
      key: "surface",
      name: "纸张",
      role: "background",
      value: "#FFFFFF",
      position: 0,
    },
    {
      key: "primary",
      name: "主色",
      role: "primary",
      value: "#315AF8",
      position: 1,
    },
  ],
  logos: [
    {
      key: "icon",
      name: "图标",
      role: "icon",
      assetId: "01K00000000000000000000001",
      artifactId: "01K00000000000000000000002",
      position: 0,
    },
    {
      key: "primary",
      name: "主 Logo",
      role: "primary",
      assetId: "01K00000000000000000000003",
      artifactId: "01K00000000000000000000004",
      position: 1,
    },
  ],
  textStyles: [
    {
      key: "body",
      name: "正文",
      role: "body",
      fontId: "body",
      fontRevision: "1",
      fontFamily: "Inter",
      fontSize: 32,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      position: 0,
    },
    {
      key: "title",
      name: "标题",
      role: "title",
      fontId: "title",
      fontRevision: "1",
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: 700,
      lineHeight: 1.1,
      letterSpacing: -1,
      position: 1,
    },
  ],
} as BrandKitRevision;

describe("brand social starter", () => {
  it("derives primary visual defaults without storing them in component state", () => {
    expect(brandSocialStarterDefaultsV1(revision)).toEqual({
      logoArtifactId: "01K00000000000000000000004",
      backgroundColor: "#315AF8FF",
    });
    expect(brandSocialStarterTitleStyleV1(revision)?.key).toBe("title");
  });

  it("projects bounded user copy and canvas dimensions", () => {
    expect(brandSocialStarterHeadlineV1({ headline: "  夏日上新  " })).toBe(
      "夏日上新",
    );
    expect(
      brandSocialStarterBackgroundColorV1({ backgroundColor: "#315AF8FF" }),
    ).toBe("#315AF8FF");
    expect(
      brandSocialStarterCanvasSizeV1({ canvas: { width: 1200, height: 628 } }),
    ).toEqual({ width: 1200, height: 628 });
    expect(brandSocialStarterCanvasSizeV1({})).toEqual({
      width: 1080,
      height: 1080,
    });
  });
});
