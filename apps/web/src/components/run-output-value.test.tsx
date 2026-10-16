import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunOutputValue, type RunOutputSchema } from "./run-output-value.js";

function renderOutput(value: unknown, schema?: RunOutputSchema): string {
  return renderToStaticMarkup(
    <RunOutputValue
      emptyLabel="空"
      noLabel="否"
      {...(schema ? { schema } : {})}
      value={value}
      yesLabel="是"
    />,
  );
}

describe("RunOutputValue", () => {
  it("renders scalar object fields in schema order with localized values", () => {
    const markup = renderOutput(
      {
        enabled: true,
        note: "",
        schemaVersion: "customer-result/v2",
        visible: false,
      },
      {
        type: "object",
        properties: {
          visible: { type: "boolean", title: "公开" },
          enabled: { type: "boolean", title: "启用" },
          schemaVersion: { type: "string", title: "版本" },
          note: { type: "string", title: "备注" },
        },
      },
    );

    expect(markup).toContain("ant-descriptions");
    expect(markup.indexOf("公开")).toBeLessThan(markup.indexOf("启用"));
    expect(markup).toContain("是");
    expect(markup).toContain("否");
    expect(markup).toContain("customer-result/v2");
    expect(markup).toContain("空");
    expect(markup).not.toContain("<pre");
  });

  it("renders heterogeneous record arrays as a complete readable table", () => {
    const markup = renderOutput(
      [
        { rank: 1, hex: "#1F5F99", enabled: true },
        { hex: "#F0D7A1", rank: 2, enabled: false, note: "secondary" },
      ],
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            hex: { type: "string", title: "色值" },
            rank: { type: "integer", title: "顺序" },
            enabled: { type: "boolean", title: "采用" },
          },
        },
      },
    );

    expect(markup).toContain("ant-table");
    expect(markup.indexOf("色值")).toBeLessThan(markup.indexOf("顺序"));
    expect(markup).toContain("#1F5F99");
    expect(markup).toContain("#F0D7A1");
    expect(markup).toContain("secondary");
    expect(markup).toContain(">note<");
    expect(markup).toContain("background-color:#1F5F99");
    expect(markup).toContain("是");
    expect(markup).toContain("否");
    expect(markup).not.toContain("<pre");
  });

  it("keeps every item in scalar and nested arrays", () => {
    const markup = renderOutput([
      "first",
      { state: true, values: [1, 2, 3] },
      null,
    ]);

    expect(markup).toContain("first");
    expect(markup).toContain("state");
    expect(markup).toContain("values");
    expect(markup).toContain("是");
    expect(markup).toContain(">1<");
    expect(markup).toContain(">2<");
    expect(markup).toContain(">3<");
    expect(markup).toContain("空");
  });
});
