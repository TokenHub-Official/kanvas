import { describe, expect, it } from "vitest";

import {
  initialAppShellOverlayState,
  reduceAppShellOverlay,
} from "./app-shell-overlay-state.js";

describe("reduceAppShellOverlay", () => {
  it("keeps workspace and account menus mutually exclusive", () => {
    const workspaceOpen = reduceAppShellOverlay(initialAppShellOverlayState, {
      type: "workspace_menu_changed",
      open: true,
    });

    expect(
      reduceAppShellOverlay(workspaceOpen, {
        type: "account_menu_changed",
        open: true,
      }),
    ).toMatchObject({
      accountMenuOpen: true,
      workspaceMenuOpen: false,
      workspaceQuery: "",
    });
  });

  it("closes the panel incompatible with the active breakpoint", () => {
    const bothPanels = {
      ...initialAppShellOverlayState,
      workspaceDrawerOpen: true,
      workspaceMenuOpen: true,
      workspaceQuery: "studio",
    };

    expect(
      reduceAppShellOverlay(bothPanels, {
        type: "breakpoint_changed",
        desktop: true,
      }),
    ).toMatchObject({
      workspaceDrawerOpen: false,
      workspaceMenuOpen: true,
      workspaceQuery: "",
    });
  });

  it("clears import errors whenever the create dialog closes", () => {
    const failed = reduceAppShellOverlay(
      {
        ...initialAppShellOverlayState,
        createDialogOpen: true,
      },
      { type: "create_import_failed", error: "Unsupported image" },
    );

    expect(reduceAppShellOverlay(failed, { type: "create_closed" })).toEqual(
      initialAppShellOverlayState,
    );
  });
});
