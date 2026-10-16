import { describe, expect, it } from "vitest";

import { modelResourceDownloadPercent } from "./model-resource-download-progress.js";

describe("model resource download progress", () => {
  it("reports real byte progress while reserving completion for the next stage", () => {
    expect(modelResourceDownloadPercent("0", "104857600")).toBe(0);
    expect(modelResourceDownloadPercent("52428800", "104857600")).toBe(50);
    expect(modelResourceDownloadPercent("104857600", "104857600")).toBe(99);
  });

  it("falls back to indeterminate progress when the total is unavailable", () => {
    expect(modelResourceDownloadPercent("1048576", undefined)).toBeUndefined();
    expect(
      modelResourceDownloadPercent("invalid", "104857600"),
    ).toBeUndefined();
  });
});
