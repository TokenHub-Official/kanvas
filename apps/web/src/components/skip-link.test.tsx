import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n.js";

import { SkipLink } from "./skip-link.js";

describe("SkipLink", () => {
  it("is the named keyboard shortcut to a stable content target", async () => {
    await i18n.changeLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SkipLink targetId="kanvas-main-content" />,
    );

    expect(markup).toContain('href="#kanvas-main-content"');
    expect(markup).toContain("跳到主要内容");
  });
  it("uses the selected product language", async () => {
    await i18n.changeLanguage("en-US");
    expect(
      renderToStaticMarkup(<SkipLink targetId="kanvas-main-content" />),
    ).toContain("Skip to main content");
    await i18n.changeLanguage("zh-CN");
  });
});
