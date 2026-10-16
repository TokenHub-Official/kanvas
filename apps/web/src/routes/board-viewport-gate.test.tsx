import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../i18n/i18n.js";
import {
  BoardDesktopRequired,
  BoardViewportDecision,
  boardDesktopRequiredTitleId,
  boardDesktopStageId,
  boardEditorMediaQuery,
  boardViewportFocusTargetId,
  focusBoardViewportSurface,
} from "./board-viewport-gate.js";

describe("board desktop viewport gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("uses the standard tablet boundary for the editor", () => {
    expect(boardEditorMediaQuery).toBe("(min-width: 768px)");
  });

  it("moves focus with the active viewport surface", () => {
    expect(boardViewportFocusTargetId(false)).toBe(boardDesktopRequiredTitleId);
    expect(boardViewportFocusTargetId(true)).toBe(boardDesktopStageId);
  });

  it("focuses the requested surface without scrolling", () => {
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ focus }));
    vi.stubGlobal("document", { getElementById });

    focusBoardViewportSurface(true);

    expect(getElementById).toHaveBeenCalledWith(boardDesktopStageId);
    expect(focus).toHaveBeenCalledWith({
      preventScroll: true,
    });
  });

  it("renders an accessible localized desktop handoff", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BoardDesktopRequired onBack={() => undefined} />
      </I18nextProvider>,
    );

    expect(markup).toContain("<main");
    expect(markup).toContain('data-page-focus-target="true"');
    expect(markup).toContain("请在更大屏幕打开画板");
    expect(markup).toContain("返回工作台");
    expect(markup).not.toContain('role="alert"');
  });

  it("does not render desktop children before access is granted", () => {
    const blocked = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BoardViewportDecision
          desktopContentLoaded={false}
          desktopViewport={false}
          onBack={() => undefined}
        >
          <span>desktop editor loaded</span>
        </BoardViewportDecision>
      </I18nextProvider>,
    );
    const granted = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BoardViewportDecision
          desktopContentLoaded
          desktopViewport
          onBack={() => undefined}
        >
          <span>desktop editor loaded</span>
        </BoardViewportDecision>
      </I18nextProvider>,
    );

    expect(blocked).not.toContain("desktop editor loaded");
    expect(granted).toContain("desktop editor loaded");
  });

  it("keeps an entered editor mounted behind the narrow-screen handoff", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <BoardViewportDecision
          desktopContentLoaded
          desktopViewport={false}
          onBack={() => undefined}
        >
          <span>desktop editor retained</span>
        </BoardViewportDecision>
      </I18nextProvider>,
    );

    expect(markup).toContain("desktop editor retained");
    expect(markup).toContain("hidden");
    expect(markup).toContain("请在更大屏幕打开画板");
  });
});
