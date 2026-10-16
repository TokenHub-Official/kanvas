import { beforeEach, describe, expect, it } from "vitest";

import { ApiProblem } from "../../api/transport.js";
import { i18n } from "../../i18n/i18n.js";
import { canvasExportFailureMessageV1 } from "./canvas-export-feedback-v1.js";

describe("canvasExportFailureMessageV1", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new TypeError("NetworkError when attempting to fetch resource."),
    new ApiProblem(
      0,
      "upload_transport_failed",
      "Canvas Export could not reach Kanvas Server.",
    ),
  ])("explains that an uncertain transport result is recoverable", (error) => {
    expect(canvasExportFailureMessageV1(error)).toBe(
      "导出结果暂时无法确认。结果可能已经保存；可继续上次导出，刷新后也会恢复同一结果，不会重复创建。",
    );
  });

  it("preserves a specific local recovery instruction", () => {
    expect(
      canvasExportFailureMessageV1(
        new Error("请先处理画板的版本冲突，再开始导出。"),
      ),
    ).toBe("请先处理画板的版本冲突，再开始导出。");
  });
});
