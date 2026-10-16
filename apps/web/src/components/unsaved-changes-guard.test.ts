import { describe, expect, it } from "vitest";

import {
  hasUnsavedFormChanges,
  shouldBlockUnsavedChanges,
} from "./unsaved-changes-guard.js";

describe("hasUnsavedFormChanges", () => {
  it("stays inactive before the user starts", () => {
    expect(hasUnsavedFormChanges(["", "", ""])).toBe(false);
  });

  it("protects every entered value, including whitespace", () => {
    expect(hasUnsavedFormChanges(["", " ", ""])).toBe(true);
  });

  it("protects an in-flight submission even after fields clear", () => {
    expect(hasUnsavedFormChanges(["", ""], true)).toBe(true);
  });

  it("allows only an explicitly committed navigation to bypass", () => {
    expect(shouldBlockUnsavedChanges(true, false)).toBe(true);
    expect(shouldBlockUnsavedChanges(true, true)).toBe(false);
    expect(shouldBlockUnsavedChanges(false, false)).toBe(false);
  });
});
