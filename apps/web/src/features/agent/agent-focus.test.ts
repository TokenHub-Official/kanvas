import { describe, expect, it, vi } from "vitest";

import {
  agentComposerShouldAutoFocusOnEntry,
  focusAgentComposer,
} from "./agent-focus.js";

describe("Agent focus ownership", () => {
  it("auto-focuses a ready desktop conversation without an overlay", () => {
    expect(
      agentComposerShouldAutoFocusOnEntry({
        finePointer: true,
        ready: true,
        overlayOpen: false,
      }),
    ).toBe(true);
    expect(
      agentComposerShouldAutoFocusOnEntry({
        finePointer: false,
        ready: true,
        overlayOpen: false,
      }),
    ).toBe(false);
    expect(
      agentComposerShouldAutoFocusOnEntry({
        finePointer: true,
        ready: false,
        overlayOpen: false,
      }),
    ).toBe(false);
    expect(
      agentComposerShouldAutoFocusOnEntry({
        finePointer: true,
        ready: true,
        overlayOpen: true,
      }),
    ).toBe(false);
  });

  it("focuses without scrolling and can place the caret at the end", () => {
    const target = {
      disabled: false,
      value: "继续完善海报",
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
    };

    expect(focusAgentComposer(target, { moveCaretToEnd: true })).toBe(true);
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.setSelectionRange).toHaveBeenCalledWith(6, 6);
  });

  it("does not focus a disabled or unavailable composer", () => {
    const target = {
      disabled: true,
      value: "",
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
    };

    expect(focusAgentComposer(target)).toBe(false);
    expect(focusAgentComposer(undefined)).toBe(false);
    expect(target.focus).not.toHaveBeenCalled();
  });
});
