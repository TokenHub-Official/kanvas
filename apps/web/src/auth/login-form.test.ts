import { describe, expect, it } from "vitest";

import { validateLoginFields } from "./login-form.js";

describe("login form validation", () => {
  it("identifies each missing required credential", () => {
    expect(validateLoginFields("", "")).toEqual({
      email: "required",
      password: "required",
    });
    expect(validateLoginFields("designer@example.com", "")).toEqual({
      password: "required",
    });
    expect(validateLoginFields("", "not-empty")).toEqual({
      email: "required",
    });
  });

  it("accepts a complete credential pair", () => {
    expect(validateLoginFields("designer@example.com", "not-empty")).toEqual(
      {},
    );
  });
});
