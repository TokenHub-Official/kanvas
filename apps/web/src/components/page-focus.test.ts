import { describe, expect, it, vi } from "vitest";

import {
  focusPageHeading,
  routeOwnsInitialFocus,
  routePathNeedsHeadingFocus,
} from "./page-focus.js";

describe("route heading focus", () => {
  it("moves focus only when the pathname changes", () => {
    expect(
      routePathNeedsHeadingFocus(
        "/w/workspace/assets",
        "/w/workspace/assets/asset-1",
      ),
    ).toBe(true);
    expect(
      routePathNeedsHeadingFocus("/w/workspace/assets", "/w/workspace/assets"),
    ).toBe(false);
  });

  it("leaves Agent conversation focus to the Composer", () => {
    expect(routeOwnsInitialFocus("/w/workspace/agent")).toBe(true);
    expect(routeOwnsInitialFocus("/w/workspace/agent/thread-1")).toBe(true);
    expect(routeOwnsInitialFocus("/w/workspace/agents")).toBe(false);
    expect(
      routePathNeedsHeadingFocus(
        "/w/workspace/assets",
        "/w/workspace/agent/thread-1",
      ),
    ).toBe(false);
    expect(
      routePathNeedsHeadingFocus(
        "/w/workspace/agent/thread-1",
        "/w/workspace/assets",
      ),
    ).toBe(true);
  });

  it("makes the page heading programmatically focusable before focusing it", () => {
    const target = {
      focus: vi.fn(),
      hasAttribute: vi.fn(() => false),
      setAttribute: vi.fn(),
    };
    const root = {
      querySelector: vi.fn(() => target),
    };

    expect(
      focusPageHeading(root as unknown as Pick<Document, "querySelector">),
    ).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith(
      '[data-page-focus-target]:not([data-page-focus-target="false"]), h1:not([data-page-focus-target="false"])',
    );
    expect(target.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("allows a page heading to opt out when a form has a better initial focus target", () => {
    const root = {
      querySelector: vi.fn(() => null),
    };

    expect(
      focusPageHeading(root as unknown as Pick<Document, "querySelector">),
    ).toBe(false);
    expect(root.querySelector).toHaveBeenCalledWith(
      '[data-page-focus-target]:not([data-page-focus-target="false"]), h1:not([data-page-focus-target="false"])',
    );
  });
});
