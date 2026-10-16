import { describe, expect, it } from "vitest";

import {
  createBudgetLimitDraft,
  reduceBudgetLimitDraft,
} from "./budget-limit-draft-state.js";

describe("reduceBudgetLimitDraft", () => {
  it("opens with the latest server limit", () => {
    const stale = {
      fieldError: "Invalid",
      formError: "Conflict",
      limit: "10.00",
      open: false,
    };

    expect(
      reduceBudgetLimitDraft(stale, {
        type: "open",
        originalLimit: "20.00",
      }),
    ).toEqual({
      limit: "20.00",
      open: true,
    });
  });

  it("clears both errors when the amount changes", () => {
    const errored = {
      fieldError: "Invalid",
      formError: "Conflict",
      limit: "10.00",
      open: true,
    };

    expect(
      reduceBudgetLimitDraft(errored, {
        type: "limit_changed",
        limit: "12.00",
      }),
    ).toEqual({
      fieldError: undefined,
      formError: undefined,
      limit: "12.00",
      open: true,
    });
  });

  it("resets the complete draft on close", () => {
    expect(
      reduceBudgetLimitDraft(
        {
          fieldError: "Invalid",
          limit: "12.00",
          open: true,
        },
        { type: "close", originalLimit: "10.00" },
      ),
    ).toEqual(createBudgetLimitDraft("10.00"));
  });
});
