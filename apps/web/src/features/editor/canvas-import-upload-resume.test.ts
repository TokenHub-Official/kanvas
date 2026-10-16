import { describe, expect, it } from "vitest";

import {
  canvasImportErrorOnStart,
  canvasImportFailureMessage,
  canvasImportResumeAction,
  canvasImportShouldRestoreSavedStatus,
} from "./canvas-import-upload-resume.js";

describe("canvas import upload resume", () => {
  it("clears a stale failure when the failed item starts retrying", () => {
    expect(
      canvasImportErrorOnStart("failed", "图片上传失败。"),
    ).toBeUndefined();
    expect(canvasImportErrorOnStart("uploading", "另一项操作仍需处理。")).toBe(
      "另一项操作仍需处理。",
    );
  });

  it("uploads only an open session that has no stored content", () => {
    expect(canvasImportResumeAction("open", false)).toBe("upload");
    expect(canvasImportResumeAction("open", true)).toBe("commit");
  });

  it("turns network failures into phase-aware recovery copy", () => {
    expect(
      canvasImportFailureMessage(new TypeError("Failed to fetch"), false, true),
    ).toBe("图片上传已中断。图片仍保留在画板，请检查网络后重试。");
    expect(
      canvasImportFailureMessage(new TypeError("Failed to fetch"), true, true),
    ).toBe(
      "上传结果暂时无法确认。图片仍保留在画板，请重试以恢复同一上传会话。",
    );
  });

  it("explains permission loss without discarding the local image", () => {
    expect(canvasImportFailureMessage({ status: 403 }, false, true)).toBe(
      "当前权限已变化，图片未上传。图片仍保留在画板；恢复画板与素材编辑权限后可重试。",
    );
  });

  it("restores saved status when cancellation returns to the saved fingerprint", () => {
    expect(canvasImportShouldRestoreSavedStatus("uploading", 0, true)).toBe(
      true,
    );
    expect(canvasImportShouldRestoreSavedStatus("uploading", 1, true)).toBe(
      false,
    );
    expect(canvasImportShouldRestoreSavedStatus("uploading", 0, false)).toBe(
      false,
    );
  });

  it("replays commit after verification or a lost commit response", () => {
    expect(canvasImportResumeAction("verified", false)).toBe("commit");
    expect(canvasImportResumeAction("committed", false)).toBe("commit");
  });

  it("waits instead of uploading into a transitioning session", () => {
    expect(canvasImportResumeAction("sealing", false)).toBe("wait");
    expect(canvasImportResumeAction("verifying", false)).toBe("wait");
  });
});
