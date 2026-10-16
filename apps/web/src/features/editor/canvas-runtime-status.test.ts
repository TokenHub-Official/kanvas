import { describe, expect, it } from "vitest";

import {
  canvasRuntimeErrorMessage,
  canvasRuntimeOfflineMessage,
  isCanvasRuntimeOfflineMessage,
} from "./canvas-runtime-status.js";

describe("canvas runtime status", () => {
  it("turns offline fetch failures into recoverable product copy", () => {
    expect(
      canvasRuntimeErrorMessage(
        new TypeError("Failed to fetch"),
        "本机处理暂时不可用。",
        true,
      ),
    ).toBe(canvasRuntimeOfflineMessage);
    expect(
      canvasRuntimeErrorMessage(
        new Error("connection lost"),
        "本机处理暂时不可用。",
        false,
      ),
    ).toBe(canvasRuntimeOfflineMessage);
  });

  it("redacts internal runtime failures behind actionable product copy", () => {
    expect(
      canvasRuntimeErrorMessage(
        new Error("模型摘要不匹配"),
        "本机处理暂时不可用。",
        true,
      ),
    ).toBe("本机处理暂时不可用。");
    expect(
      canvasRuntimeErrorMessage(
        new Error("Browser Attempt revoked."),
        "已自动切换到云端继续处理。",
        true,
      ),
    ).toBe("已自动切换到云端继续处理。");
    expect(
      canvasRuntimeErrorMessage(undefined, "本机处理暂时不可用。", true),
    ).toBe("本机处理暂时不可用。");
  });

  it("only clears the dedicated offline runtime message", () => {
    expect(isCanvasRuntimeOfflineMessage(canvasRuntimeOfflineMessage)).toBe(
      true,
    );
    expect(isCanvasRuntimeOfflineMessage("处理完成。")).toBe(false);
    expect(isCanvasRuntimeOfflineMessage(undefined)).toBe(false);
  });
});
