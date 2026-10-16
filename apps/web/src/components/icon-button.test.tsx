import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IconButton } from "./icon-button.js";

describe("IconButton toggle semantics", () => {
  it("omits toggle state for ordinary icon actions", () => {
    const markup = renderToStaticMarkup(
      <IconButton label="关闭">×</IconButton>,
    );

    expect(markup).not.toContain("aria-pressed");
  });

  it("exposes both selected and unselected toggle states", () => {
    const selected = renderToStaticMarkup(
      <IconButton label="隐藏密码" selected>
        ×
      </IconButton>,
    );
    const unselected = renderToStaticMarkup(
      <IconButton label="显示密码" selected={false}>
        ×
      </IconButton>,
    );

    expect(selected).toContain('aria-pressed="true"');
    expect(unselected).toContain('aria-pressed="false"');
  });
});
