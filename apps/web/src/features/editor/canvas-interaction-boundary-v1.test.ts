import { describe, expect, it, vi } from "vitest";

import {
  canvasEditorActionAllowedV1,
  canvasEscapeEventPathOwnsOverlayV1,
  canvasKeyboardEventPathOwnsInputV1,
  canvasPageForTextEditingV1,
  canvasSelectionChangeClosesOverlaysV1,
  canvasStageTargetClearsSelectionV1,
  canvasTextEditingDraftForDoubleClickV1,
  canvasTextNodeIdForDoubleClickV1,
  focusCanvasStageAfterPanelActionV1,
  focusCanvasTextEditorAtEndV1,
  stopCanvasChromePointerDownV1,
  stopCanvasChromeWheelV1,
  canvasWheelEventPathOwnsOverlayV1,
} from "./canvas-interaction-boundary-v1.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";

describe("Canvas editor chrome interaction boundary", () => {
  it("stops toolbar pointer input before the stage can clear selection", () => {
    const stopPropagation = vi.fn();

    stopCanvasChromePointerDownV1({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("stops inspector scrolling before it can pan the stage", () => {
    const stopPropagation = vi.fn();

    stopCanvasChromeWheelV1({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("keeps portalled scroll owners from reaching canvas pan and zoom", () => {
    const target = (owner: boolean): EventTarget =>
      ({
        getAttribute(name: string) {
          return owner && name === "data-canvas-wheel-owner" ? "" : null;
        },
      }) as unknown as EventTarget;

    expect(canvasWheelEventPathOwnsOverlayV1([target(true)])).toBe(true);
    expect(canvasWheelEventPathOwnsOverlayV1([target(false)])).toBe(false);
  });

  it("returns keyboard ownership to the stage after a panel inserts content", () => {
    const focus = vi.fn();

    focusCanvasStageAfterPanelActionV1({ focus });

    expect(focus).toHaveBeenCalledWith({
      preventScroll: true,
    });
  });

  it("focuses inline text editing at the end of existing content", () => {
    const editor = {
      focus: vi.fn(),
      selectionEnd: 0,
      selectionStart: 0,
      value: "添加文字",
    };

    focusCanvasTextEditorAtEndV1(editor);

    expect(editor.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(editor.selectionStart).toBe(4);
    expect(editor.selectionEnd).toBe(4);
  });

  it("keeps read-only interaction to selection and navigation actions", () => {
    expect(canvasEditorActionAllowedV1(false, "select")).toBe(true);
    expect(canvasEditorActionAllowedV1(false, "set_active_page")).toBe(true);
    expect(canvasEditorActionAllowedV1(false, "replace_node")).toBe(false);
    expect(canvasEditorActionAllowedV1(false, "delete_selected")).toBe(false);
    expect(canvasEditorActionAllowedV1(false, "commit_local_image")).toBe(true);
    expect(canvasEditorActionAllowedV1(false, "cancel_preview")).toBe(true);
    expect(canvasEditorActionAllowedV1(false, "fail_local_image")).toBe(true);
    expect(canvasEditorActionAllowedV1(true, "replace_node")).toBe(true);
  });

  it("clears selection only for a primary click on the graphite stage", () => {
    expect(
      canvasStageTargetClearsSelectionV1(["canvas-v1-stage-scroll"], 0),
    ).toBe(true);
    expect(
      canvasStageTargetClearsSelectionV1(["canvas-v1-page-frame"], 0),
    ).toBe(false);
    expect(canvasStageTargetClearsSelectionV1(["canvas-v1-stage"], 1)).toBe(
      false,
    );
  });

  it("closes node overlays when the selection identity changes", () => {
    expect(
      canvasSelectionChangeClosesOverlaysV1(["shape-a"], ["shape-b"]),
    ).toBe(true);
    expect(
      canvasSelectionChangeClosesOverlaysV1(["shape-a"], ["shape-a"]),
    ).toBe(false);
  });

  it("keeps canvas shortcuts away from interactive chrome", () => {
    const target = (
      tagName: string,
      attributes: Record<string, string> = {},
    ): EventTarget =>
      ({
        tagName,
        getAttribute(name: string) {
          return attributes[name] ?? null;
        },
      }) as unknown as EventTarget;

    expect(
      canvasKeyboardEventPathOwnsInputV1([target("svg"), target("BUTTON")]),
    ).toBe(true);
    expect(
      canvasKeyboardEventPathOwnsInputV1([target("div", { role: "menuitem" })]),
    ).toBe(true);
    expect(
      canvasKeyboardEventPathOwnsInputV1([target("div", { role: "tab" })]),
    ).toBe(true);
    expect(
      canvasKeyboardEventPathOwnsInputV1([
        target("div", {
          role: "combobox",
          "aria-expanded": "false",
        }),
      ]),
    ).toBe(true);
    expect(
      canvasKeyboardEventPathOwnsInputV1([
        target("section", {
          "data-canvas-keyboard-owner": "",
        }),
      ]),
    ).toBe(true);
  });

  it("keeps canvas shortcuts active on the focused stage", () => {
    const stage = {
      tagName: "DIV",
      getAttribute(name: string) {
        return name === "aria-label" ? "设计画布" : null;
      },
    } as unknown as EventTarget;

    expect(canvasKeyboardEventPathOwnsInputV1([stage])).toBe(false);
  });

  it("lets menus and dialogs own Escape before the canvas clears selection", () => {
    const target = (
      role: string,
      attributes: Record<string, string> = {},
    ): EventTarget =>
      ({
        getAttribute(name: string) {
          return name === "role" ? role : (attributes[name] ?? null);
        },
      }) as unknown as EventTarget;

    expect(
      canvasEscapeEventPathOwnsOverlayV1([target("menuitem"), target("menu")]),
    ).toBe(true);
    expect(
      canvasEscapeEventPathOwnsOverlayV1([target("button"), target("dialog")]),
    ).toBe(true);
    expect(canvasEscapeEventPathOwnsOverlayV1([target("button")])).toBe(false);
    expect(
      canvasEscapeEventPathOwnsOverlayV1([target("option"), target("listbox")]),
    ).toBe(true);
    expect(
      canvasEscapeEventPathOwnsOverlayV1([
        target("combobox", { "aria-expanded": "true" }),
      ]),
    ).toBe(true);
    expect(
      canvasEscapeEventPathOwnsOverlayV1([
        target("combobox", { "aria-expanded": "false" }),
      ]),
    ).toBe(false);
  });

  it("protects editable content unless it is explicitly disabled", () => {
    const editable = {
      tagName: "DIV",
      isContentEditable: true,
      getAttribute() {
        return null;
      },
    } as unknown as EventTarget;
    const disabled = {
      tagName: "DIV",
      isContentEditable: false,
      getAttribute(name: string) {
        return name === "contenteditable" ? "false" : null;
      },
    } as unknown as EventTarget;

    expect(canvasKeyboardEventPathOwnsInputV1([editable])).toBe(true);
    expect(canvasKeyboardEventPathOwnsInputV1([disabled])).toBe(false);
  });

  it("resolves selected text by geometry when selection chrome owns the event path", () => {
    const selectedText = {
      id: "text-1",
      kind: "text",
      transform: {
        x: 100,
        y: 120,
        width: 300,
        height: 90,
        rotation: 0,
      },
    } as unknown as EditorRuntimePageV1["nodes"][number];

    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, selectedText, {
        x: 220,
        y: 160,
      }),
    ).toBe("text-1");
    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, selectedText, {
        x: 40,
        y: 40,
      }),
    ).toBeUndefined();
  });

  it("honors rotation when resolving a selected text double click", () => {
    const selectedText = {
      id: "text-rotated",
      kind: "text",
      transform: {
        x: 100,
        y: 100,
        width: 200,
        height: 60,
        rotation: 45,
      },
    } as unknown as EditorRuntimePageV1["nodes"][number];

    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, selectedText, {
        x: 200,
        y: 130,
      }),
    ).toBe("text-rotated");
    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, selectedText, {
        x: 100,
        y: 100,
      }),
    ).toBeUndefined();
  });

  it("prefers the node identity from the DOM event path", () => {
    expect(
      canvasTextNodeIdForDoubleClickV1("text-path", undefined, { x: 0, y: 0 }),
    ).toBe("text-path");
  });

  it("uses the same double-click entrypoint for artistic text", () => {
    const artisticText = {
      id: "art-text-1",
      kind: "text",
      effects: [
        {
          kind: "outline",
          color: "#151515",
          width: 6,
        },
      ],
      transform: {
        x: 80,
        y: 60,
        width: 260,
        height: 96,
        rotation: 0,
      },
    } as unknown as EditorRuntimePageV1["nodes"][number];

    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, artisticText, {
        x: 160,
        y: 100,
      }),
    ).toBe("art-text-1");
  });

  it("preserves the live draft when text is double-clicked again during editing", () => {
    const current = {
      nodeId: "text-1",
      value: "ABC",
    };

    expect(canvasTextEditingDraftForDoubleClickV1(current, "text-1", "A")).toBe(
      current,
    );
    expect(
      canvasTextEditingDraftForDoubleClickV1(current, "text-2", "Second"),
    ).toEqual({
      nodeId: "text-2",
      value: "Second",
    });
  });

  it("projects the editing draft through the single SVG text renderer", () => {
    const page = {
      id: "page-1",
      name: "Page",
      width: 1080,
      height: 1080,
      background: {
        kind: "transparent",
      },
      nodes: [
        {
          id: "text-1",
          name: "Text",
          kind: "text",
          visible: true,
          content: {
            paragraphs: [
              {
                runs: [
                  {
                    text: "Original",
                  },
                ],
              },
            ],
          },
          effects: [
            {
              kind: "outline",
              color: "#151515",
              width: 6,
            },
          ],
        },
        {
          id: "shape-1",
          name: "Shape",
          kind: "shape",
          visible: true,
        },
      ],
    } as unknown as EditorRuntimePageV1;

    const projected = canvasPageForTextEditingV1(page, {
      nodeId: "text-1",
      value: "Draft\nSecond line",
    });

    expect(projected.nodes).toMatchObject([
      {
        id: "text-1",
        visible: true,
        content: {
          paragraphs: [
            {
              runs: [{ text: "Draft" }],
            },
            {
              runs: [{ text: "Second line" }],
            },
          ],
        },
        effects: [
          {
            kind: "outline",
            color: "#151515",
            width: 6,
          },
        ],
      },
      {
        id: "shape-1",
        visible: true,
      },
    ]);
    expect(canvasPageForTextEditingV1(page, undefined)).toBe(page);
  });

  it("uses the same draft projection for editable sticky-note labels", () => {
    const note = {
      id: "note-1",
      name: "便签",
      kind: "shape",
      visible: true,
      transform: {
        x: 100,
        y: 120,
        width: 280,
        height: 260,
        rotation: 0,
      },
      label: {
        padding: {
          top: 30,
          right: 34,
          bottom: 52,
          left: 30,
        },
        content: {
          paragraphs: [
            {
              runs: [
                {
                  text: "添加便签",
                },
              ],
            },
          ],
        },
      },
    } as unknown as EditorRuntimePageV1["nodes"][number];
    const page = {
      id: "page-note",
      name: "Page",
      width: 1080,
      height: 1080,
      background: {
        kind: "transparent",
      },
      nodes: [note],
    } as unknown as EditorRuntimePageV1;

    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, note, { x: 180, y: 180 }),
    ).toBe("note-1");
    expect(
      canvasPageForTextEditingV1(page, {
        nodeId: "note-1",
        value: "新的便签内容",
      }).nodes[0],
    ).toMatchObject({
      kind: "shape",
      label: {
        content: {
          paragraphs: [
            {
              runs: [{ text: "新的便签内容" }],
            },
          ],
        },
      },
    });
  });

  it("lets a closed shape without a label enter internal text editing", () => {
    const shape = {
      id: "shape-empty-label",
      name: "Rectangle",
      kind: "shape",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      transform: {
        x: 100,
        y: 120,
        width: 280,
        height: 180,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      definition: {
        catalogId: "kanvas.core.shapes",
        definitionId: "basic.rectangle",
        revision: "2026-07-31",
      },
      parameters: {},
      fill: { kind: "none" },
      stroke: {
        paint: { kind: "solid", color: "#151515" },
        width: 2,
        alignment: "inside",
      },
    } as unknown as EditorRuntimePageV1["nodes"][number];
    const page = {
      id: "page-shape-label",
      name: "Page",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" },
      nodes: [shape],
    } as unknown as EditorRuntimePageV1;

    expect(
      canvasTextNodeIdForDoubleClickV1(undefined, shape, { x: 180, y: 180 }),
    ).toBe("shape-empty-label");
    expect(
      canvasPageForTextEditingV1(page, {
        nodeId: "shape-empty-label",
        value: "内部说明",
      }).nodes[0],
    ).toMatchObject({
      kind: "shape",
      fill: { kind: "none" },
      label: {
        content: {
          paragraphs: [
            { runs: [{ text: "内部说明", fill: { color: "#151515" } }] },
          ],
        },
      },
    });
    expect(shape).not.toHaveProperty("label");
  });
});
