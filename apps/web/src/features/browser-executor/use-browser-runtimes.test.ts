import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../api/transport.js";
import { BrowserExecutorStartupError } from "./browser-executor-runtime.js";
import {
  browserRuntimeCoversCapabilities,
  browserRuntimeFailure,
} from "./use-browser-runtimes.js";

describe("standalone browser runtime coverage", () => {
  it("reports ready coverage only when every Run-required capability is supported", () => {
    expect(
      browserRuntimeCoversCapabilities(
        ["image.background.remove", "image.quality.assess"],
        ["image.background.remove"],
      ),
    ).toBe(false);
    expect(
      browserRuntimeCoversCapabilities(
        ["image.background.remove", "image.quality.assess"],
        [
          "image.background.remove",
          "image.quality.assess",
          "image.palette.extract",
        ],
      ),
    ).toBe(true);
  });

  it("reports only a safe startup stage and HTTP classification", () => {
    expect(
      browserRuntimeFailure(
        "runtime",
        new BrowserExecutorStartupError(
          "register",
          new ApiProblem(409, "browser_control.runtime_fenced", "raw detail"),
        ),
      ),
    ).toEqual({
      stage: "register",
      httpStatus: 409,
      code: "browser_control.runtime_fenced",
    });
    expect(
      browserRuntimeFailure(
        "runtime",
        new BrowserExecutorStartupError("probe", new Error("raw detail")),
      ),
    ).toEqual({ stage: "probe" });
  });
});
