import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
describe("Canvas operation review copy", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("localizes modal titles, decisions, and aria copy", () => {
    expect(
      i18n.t("canvas.operationReview.title.decision", {
        tool: "去背景",
      }),
    ).toBe("查看“去背景”结果");
    expect(i18n.t("canvas.operationReview.actions.replace_content")).toBe(
      "替换原图",
    );
    expect(i18n.t("canvas.operationReview.previewContent")).toBe("预览内容");
  });
});
