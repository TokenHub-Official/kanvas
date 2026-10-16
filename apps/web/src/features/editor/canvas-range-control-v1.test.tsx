import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CanvasRangeControlV1 } from "./canvas-range-control-v1.js";

describe("CanvasRangeControlV1", () => {
  it("renders one labelled Ant Design slider with a formatted value", () => {
    const markup = renderToStaticMarkup(
      <CanvasRangeControlV1
        formatValue={(value) => value.toFixed(2)}
        label="行高"
        maximum={3}
        minimum={0.5}
        onChange={vi.fn()}
        step={0.05}
        value={1.2}
      />,
    );

    expect(markup).toContain('aria-label="行高"');
    expect(markup).toContain(">1.20</output>");
    expect(markup).toContain("ant-slider");
    expect(markup).not.toContain('type="range"');
  });
});
