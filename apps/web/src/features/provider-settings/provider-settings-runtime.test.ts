import { beforeEach, describe, expect, it } from "vitest";

import { ApiProblem } from "../../api/transport.js";
import { i18n } from "../../i18n/i18n.js";
import { providerSettingsError } from "./provider-settings-runtime.js";

describe("providerSettingsError", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));

  it("distinguishes missing initialization from stale configuration", () => {
    expect(
      providerSettingsError(
        new ApiProblem(
          503,
          "provider_settings.policy_not_initialized",
          "internal",
        ),
      ),
    ).toBe("模型服务初始化尚未完成，请联系实例管理员完成初始化后重试。");
  });

  it("replaces internal server messages with recovery guidance", () => {
    const message = providerSettingsError(
      new ApiProblem(500, "internal_error", "Internal server error"),
    );
    expect(message).not.toBe("Internal server error");
    expect(message).toMatch(/重新加载|Reload/u);
  });

  it("localizes client and unknown API failures without exposing server copy", async () => {
    await i18n.changeLanguage("en-US");
    const message = providerSettingsError(
      new ApiProblem(400, "provider.invalid", "供应商参数错误"),
    );

    expect(message).toBe("Check the marked fields.");
    expect(message).not.toContain("供应商");
  });
});
