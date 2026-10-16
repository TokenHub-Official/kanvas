import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicResult } from "./public-entry-shell.js";

describe("public result", () => {
  it("keeps result pages concise and exposes one page heading", () => {
    const markup = renderToStaticMarkup(
      <PublicResult
        description="Ask the administrator for a new link."
        icon={<span>link</span>}
        primaryAction={{
          icon: <span>home</span>,
          label: "Return",
          onClick: () => undefined,
        }}
        title="Invitation expired"
        tone="warning"
      />,
    );

    expect(markup).toContain("<h1");
    expect(markup).not.toContain("<h2");
    expect(markup).toContain("Invitation expired");
    expect(markup).toContain("Ask the administrator for a new link.");
    expect(markup).toContain("Return");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("bg-[var(--warning-surface)]");
  });

  it("supports a secondary recovery path without inventing extra content", () => {
    const markup = renderToStaticMarkup(
      <PublicResult
        icon={<span>cloud</span>}
        primaryAction={{
          icon: <span>retry</span>,
          iconPlacement: "start",
          label: "Try again",
          onClick: () => undefined,
        }}
        secondaryAction={{
          icon: <span>home</span>,
          label: "Return",
          onClick: () => undefined,
        }}
        title="Unable to verify invitation"
      />,
    );

    expect(markup).toContain("Try again");
    expect(markup).toContain("retry");
    expect(markup).toContain("cloud");
    expect(markup).toContain("Return");
    expect(markup).not.toContain("<p class=");
  });
});
