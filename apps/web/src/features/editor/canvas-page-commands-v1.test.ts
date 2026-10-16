import { describe, expect, it, vi } from "vitest";

import { createCanvasPageCommandsV1 } from "./canvas-page-commands-v1.js";
import { createEditorPageV1 } from "./editor-document-factory-v1.js";
import type { EditorActionV1 } from "./editor-state-v1.js";

function createCommands() {
  const actions: EditorActionV1[] = [];
  const commitPreview = vi.fn();
  const hideEditorPanels = vi.fn();
  const page = createEditorPageV1("page-1", "Page 1");
  const commands = createCanvasPageCommandsV1({
    commitPreview,
    hideEditorPanels,
    mutate: (action) => {
      actions.push(action);
    },
    page,
    pageCount: 1,
    t: ((key: string) => key) as never,
  });
  return {
    actions,
    commands,
    commitPreview,
    hideEditorPanels,
    page,
  };
}

describe("createCanvasPageCommandsV1", () => {
  it("targets page commands at the active page", () => {
    const { actions, commands, page } = createCommands();

    commands.movePageForward();
    commands.resizePage(1_200, 800, "scale");
    commands.clearGuides();

    expect(actions).toEqual([
      {
        type: "move_page",
        pageId: page.id,
        direction: "forward",
      },
      {
        type: "resize_page",
        pageId: page.id,
        width: 1_200,
        height: 800,
        mode: "scale",
      },
      {
        type: "set_page_guides",
        pageId: page.id,
        guides: [],
      },
    ]);
  });

  it("commits previews and closes panels before changing pages", () => {
    const { actions, commands, commitPreview, hideEditorPanels } =
      createCommands();

    commands.activatePage("page-2");

    expect(commitPreview).toHaveBeenCalledOnce();
    expect(hideEditorPanels).toHaveBeenCalledOnce();
    expect(actions).toEqual([
      {
        type: "set_active_page",
        pageId: "page-2",
      },
    ]);
  });

  it("renames and directly reorders pages", () => {
    const { actions, commands } = createCommands();

    commands.renamePage("封面");
    commands.reorderPage("page-1", 2);

    expect(actions).toEqual([
      { type: "rename_page", pageId: "page-1", name: "封面" },
      { type: "reorder_page", pageId: "page-1", targetIndex: 2 },
    ]);
  });

  it("can explicitly delete a hovered page instead of the active page", () => {
    const { actions, commands } = createCommands();

    commands.deletePage("page-2");

    expect(actions).toEqual([{ type: "delete_page", pageId: "page-2" }]);
  });

  it("does not create image-background commands for paint pages", () => {
    const { actions, commands } = createCommands();

    commands.setBackgroundImageFit("cover");
    commands.previewBackgroundFocalPoint(0.25, 0.75);
    commands.convertBackgroundImage();

    expect(actions).toEqual([]);
  });

  it("keeps committed and preview background actions distinct", () => {
    const { actions, commands, page } = createCommands();

    commands.setBackgroundColor("#ffffff");
    commands.previewBackgroundColor("#151515");

    expect(actions).toEqual([
      {
        type: "set_page_background",
        pageId: page.id,
        background: {
          kind: "paint",
          paint: { kind: "solid", color: "#ffffff" },
        },
      },
      {
        type: "preview_page_background",
        pageId: page.id,
        background: {
          kind: "paint",
          paint: { kind: "solid", color: "#151515" },
        },
      },
    ]);
  });
});
