import { describe, expect, it, vi } from "vitest";

import {
  createCanvasCommandToolProjection,
  createKanvasMastraTools,
} from "../src/index.js";

describe("Canvas Command Tool projection", () => {
  it("projects only bounded Canvas commands and delegates canonical execution", async () => {
    const create = vi.fn(() =>
      Promise.resolve({ modelOutput: { title: "Launch" } }),
    );
    const inspect = vi.fn(() =>
      Promise.resolve({ modelOutput: { version: 1 } }),
    );
    const editText = vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({ modelOutput: { version: 2 } });
    });
    const addResultImage = vi.fn(() =>
      Promise.resolve({ modelOutput: { version: 3 } }),
    );
    const projection = createCanvasCommandToolProjection({
      create,
      inspect,
      editText,
      addResultImage,
    });
    const libraryProjection = createCanvasCommandToolProjection(
      { create, inspect, editText, addResultImage },
      { includeLibraryInputs: true },
    );
    expect(projection.digestMaterial).toEqual({ schemaVersion: 2 });
    expect(libraryProjection.digestMaterial).toEqual({ schemaVersion: 3 });
    expect(
      JSON.stringify(
        projection.descriptors.find(
          (tool) => tool.key === "canvas.add-result-image",
        )?.inputSchema,
      ),
    ).not.toContain("libraryEntryId");
    expect(
      JSON.stringify(
        libraryProjection.descriptors.find(
          (tool) => tool.key === "canvas.add-result-image",
        )?.inputSchema,
      ),
    ).toContain('"required":["libraryId","libraryEntryId"]');
    const tools = createKanvasMastraTools(projection.descriptors);
    expect(() =>
      createKanvasMastraTools(libraryProjection.descriptors),
    ).not.toThrow();

    expect(projection.family).toBe("canvas_command");
    expect(Object.keys(tools)).toEqual([
      "canvas.create",
      "canvas.inspect",
      "canvas.edit-text",
      "canvas.add-result-image",
    ]);
    await projection.descriptors[2]?.executeCanonical({
      expectedVersion: 1,
      pageKey: "page-1",
      type: "add_text",
      text: "Launch",
      x: 80,
      y: 80,
      width: 800,
      height: 120,
      fontSize: 72,
      color: "#ff0000",
    });
    await projection.descriptors[2]?.executeCanonical({
      expectedVersion: 2,
      pageKey: "page-1",
      type: "update_text",
      elementKey: "headline",
      color: "#ff0000",
    });
    expect(editText).toHaveBeenCalledTimes(2);
    expect(editText.mock.calls[0]?.[0]).toEqual({
      expectedVersion: 1,
      pageKey: "page-1",
      operations: [
        {
          type: "add_text",
          text: "Launch",
          x: 80,
          y: 80,
          width: 800,
          height: 120,
          fontSize: 72,
          color: "#ff0000",
        },
      ],
    });
    const addImage = projection.descriptors.find(
      (descriptor) => descriptor.key === "canvas.add-result-image",
    )!;
    expect(JSON.stringify(addImage.inputSchema)).toContain(
      '"required":["skillRevisionId","skillResourcePath"]',
    );
    expect(JSON.stringify(addImage.inputSchema)).toContain(
      '"skillResourcePath":{"type":"string"',
    );
    await addImage.executeCanonical({
      expectedVersion: 3,
      pageKey: "page-1",
      skillRevisionId: "01K00000000000000000000001",
      skillResourcePath: "assets/brand/frame.png",
      artifactId: "01K00000000000000000000002",
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      fit: "fill",
    });
    expect(addResultImage).toHaveBeenCalledWith({
      expectedVersion: 3,
      pageKey: "page-1",
      skillRevisionId: "01K00000000000000000000001",
      skillResourcePath: "assets/brand/frame.png",
      artifactId: "01K00000000000000000000002",
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      fit: "fill",
    });
  });
});
