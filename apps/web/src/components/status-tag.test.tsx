import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusTag } from "./status-tag.js";

describe("StatusTag", () => {
  it("maps semantic tones to Ant Design status colors", () => {
    const markup = renderToStaticMarkup(
      <StatusTag tone="positive">Ready</StatusTag>,
    );

    expect(markup).toContain("ant-tag-success");
    expect(markup).toContain("ant-tag-filled");
    expect(markup).toContain("Ready");
  });

  it("uses the inverse component theme without visual utility overrides", () => {
    const markup = renderToStaticMarkup(
      <StatusTag tone="inverse">Published</StatusTag>,
    );

    expect(markup).toContain("ant-tag-filled");
    expect(markup).toContain("Published");
    expect(markup).not.toContain("!bg-");
  });
});
