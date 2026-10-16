import { describe, expect, it } from "vitest";

import {
  formatProviderCheckDate,
  providerLifecyclePresentation,
  providerValidationTone,
} from "./provider-settings-presentation.js";

describe("Provider settings presentation", () => {
  it("keeps enablement separate from the latest connection check", () => {
    expect(providerLifecyclePresentation({ lifecycle: "active" })).toEqual({
      key: "active",
      tone: "positive",
    });
    expect(providerValidationTone("failed")).toBe("danger");
  });

  it("formats a valid check date in the selected product locale", () => {
    const value = "2026-09-02T20:04:00.000Z";
    expect(formatProviderCheckDate(value, "en-US", "UTC")).toMatch(
      /Sep 2.*08:04 PM/u,
    );
    expect(formatProviderCheckDate("not-a-date", "en-US", "UTC")).toBe(
      undefined,
    );
  });
});
