import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import {
  ProviderSettingStatusTag,
  ProviderSettingValidationText,
} from "./provider-setting-state.js";

function provider(
  input: Partial<ProviderSettingSummary> = {},
): ProviderSettingSummary {
  return {
    baseUrl: "https://api.openai.com/v1",
    canRefreshModelCatalog: false,
    createdAt: "2026-08-05T00:00:00.000Z",
    displayName: "OpenAI",
    id: "01K00000000000000000000000",
    lifecycle: "draft",
    modelKeys: ["gpt-image-1"],
    preset: "openai",
    secretConfigured: true,
    updatedAt: "2026-08-05T00:00:00.000Z",
    validation: "pending",
    version: 1,
    ...input,
  };
}

describe("provider setting table state", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders newly verified, never-activated services as ready instead of paused", () => {
    const markup = renderToStaticMarkup(
      <ProviderSettingStatusTag
        provider={provider({
          lifecycle: "disabled",
          validation: "passed",
          validatedAt: "2026-08-05T00:30:00.000Z",
        })}
      />,
    );

    expect(markup).toContain('data-provider-status="ready"');
    expect(markup).toContain("待启用");
    expect(markup).not.toContain("已暂停");
  });

  it("keeps lifecycle and failed validation as separate facts", () => {
    const failed = provider({
      lifecycle: "disabled",
      validation: "failed",
    });
    const statusMarkup = renderToStaticMarkup(
      <ProviderSettingStatusTag provider={failed} />,
    );
    const validationMarkup = renderToStaticMarkup(
      <ProviderSettingValidationText locale="zh-CN" provider={failed} />,
    );

    expect(statusMarkup).toContain('data-provider-status="inactive"');
    expect(statusMarkup).toContain("未启用");
    expect(statusMarkup).not.toContain("校验失败");
    expect(validationMarkup).toContain('data-provider-validation="failed"');
    expect(validationMarkup).toContain("校验失败");
  });

  it("renders a previously activated disabled service as paused", () => {
    const markup = renderToStaticMarkup(
      <ProviderSettingStatusTag
        provider={provider({
          activatedAt: "2026-08-05T01:00:00.000Z",
          lifecycle: "disabled",
          validation: "passed",
        })}
      />,
    );

    expect(markup).toContain('data-provider-status="disabled"');
    expect(markup).toContain("已暂停");
  });

  it("keeps active and revoked terminal states unambiguous", () => {
    const active = renderToStaticMarkup(
      <ProviderSettingStatusTag
        provider={provider({
          lifecycle: "active",
          validation: "passed",
        })}
      />,
    );
    const revoked = renderToStaticMarkup(
      <ProviderSettingStatusTag
        provider={provider({
          lifecycle: "revoked",
          validation: "failed",
        })}
      />,
    );

    expect(active).toContain('data-provider-status="active"');
    expect(active).toContain("使用中");
    expect(revoked).toContain('data-provider-status="revoked"');
    expect(revoked).toContain("不可用");
  });

  it("describes key rotation as a graceful transition without implying provider-side revocation", () => {
    const copy = [
      i18n.t("settings.providers.rotate.description"),
      i18n.t("settings.providers.rotate.transitionNote"),
    ].join(" ");

    expect(copy).toContain("新任务会立即使用新的 Key");
    expect(copy).toContain("已提交任务过渡 15 分钟");
    expect(copy).toContain("不会在服务商侧撤销");
    expect(copy).not.toContain("立即停用旧 Key");
  });
});
