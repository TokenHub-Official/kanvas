import { describe, expect, it } from "vitest";

import { canvasOperationUserMessageV1 } from "./canvas-operation-feedback-v1.js";

describe("canvas operation user feedback", () => {
  it("keeps concise recovery copy written for the user", () => {
    expect(
      canvasOperationUserMessageV1(
        new Error("当前工作区权限已变化，请重新打开画板后再试。"),
        "图片处理暂时无法完成，请重试。",
      ),
    ).toBe("当前工作区权限已变化，请重新打开画板后再试。");
  });

  it.each([
    "provider.not_found_authoritative",
    "Worker candidate failed for deployment image-v2",
    "CapabilityAttempt binding is missing",
    "执行环境配置无效",
    '{"artifactId":"01K00000000000000000000000"}',
    "https://internal.example.test/run/1",
  ])("replaces internal detail: %s", (message) => {
    expect(
      canvasOperationUserMessageV1(
        new Error(message),
        "图片处理暂时无法完成，请重试。",
      ),
    ).toBe("图片处理暂时无法完成，请重试。");
  });
});
