import { describe, expect, it } from "vitest";

import {
  canvasLeftRailDefinition,
  canvasLeftRailDefinitions,
} from "./canvas-left-rail-model.js";

describe("Canvas Core V1 left rail", () => {
  it("uses five task-oriented entrypoints in a stable order", () => {
    expect(
      canvasLeftRailDefinitions.map((definition) => definition.id),
    ).toEqual(["design", "materials", "text", "brand", "tools"]);
  });

  it("keeps layers, properties and export out of content discovery", () => {
    const ids = canvasLeftRailDefinitions.map((definition) => definition.id);

    expect(ids).not.toContain("layers");
    expect(ids).not.toContain("properties");
    expect(ids).not.toContain("export");
  });

  it("lets materials add every catalog content node without exposing empty groups", () => {
    expect(canvasLeftRailDefinition("materials").nodeKinds).toEqual([
      "image",
      "shape",
      "line",
      "graphic",
      "frame",
      "grid",
    ]);
    expect(canvasLeftRailDefinition("materials").nodeKinds).not.toContain(
      "group",
    );
  });

  it("keeps upload ingestion with reusable material discovery", () => {
    expect(canvasLeftRailDefinition("materials").scope).toBe(
      "content_discovery",
    );
  });

  it("declares the generic node kinds created by quick tools", () => {
    expect(canvasLeftRailDefinition("tools").nodeKinds).toEqual([
      "shape",
      "line",
      "text",
    ]);
  });
});
