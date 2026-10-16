import { describe, expect, it } from "vitest";
import {
  defaultCapabilityFieldLabel,
  distinctCapabilityFieldLabels,
} from "./capability-field-labels.js";

describe("automatic capability field names", () => {
  it("prefers meaningful source titles and ignores blank or raw identifiers", () => {
    expect(
      defaultCapabilityFieldLabel("quality", { title: "Rendering detail" }),
    ).toEqual({ "zh-CN": "Rendering detail", "en-US": "Rendering detail" });
    for (const title of [
      "",
      "  ",
      "quality",
      "render_quality",
      "renderQuality",
      "render-quality",
      "render.quality",
    ]) {
      expect(defaultCapabilityFieldLabel("quality", { title })["zh-CN"]).toBe(
        "质量",
      );
    }
    expect(defaultCapabilityFieldLabel("customStrength")["en-US"]).toBe(
      "Custom Strength",
    );
    expect(
      defaultCapabilityFieldLabel("quality", { title: "OpenAI image quality" })[
        "en-US"
      ],
    ).toBe("OpenAI image quality");
  });

  it("distinguishes a result image from the source returned with it", () => {
    const schema = { "x-kanvas-semantic-type": "artifact.image" };
    expect(
      ["imageArtifactId", "sourceArtifactId"].map(
        (key) => defaultCapabilityFieldLabel(key, schema)["zh-CN"],
      ),
    ).toEqual(["结果图片", "原图"]);
  });

  it("disambiguates automatic semantic names while retaining unique source titles", () => {
    const fields = ["frontView", "sideView", "otherView"].map((key) => ({
      key,
      label: defaultCapabilityFieldLabel(key, {
        "x-kanvas-semantic-type": "artifact.image",
        ...(key === "otherView" ? { title: "Preview" } : {}),
      }),
    }));
    expect(
      distinctCapabilityFieldLabels(fields).map(
        (field) => field.label["en-US"],
      ),
    ).toEqual(["Image (Front View)", "Image (Side View)", "Preview"]);
    expect(fields[0]!.label["en-US"]).toBe("Image");
  });
});
