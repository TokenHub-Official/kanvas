import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import { describe, expect, it } from "vitest";

import { canvasBrandColorTargetV1 } from "./canvas-brand-color-application-v1.js";

function node(kind: EditorRuntimeNodeV1["kind"], locked = false) {
  return { kind, locked } as EditorRuntimeNodeV1;
}

describe("canvasBrandColorTargetV1", () => {
  it.each([
    [[node("text")], "text"],
    [[node("shape")], "shape"],
    [[node("image")], "page"],
    [[node("shape", true)], "page"],
    [[node("text"), node("shape")], "page"],
    [[], "page"],
  ] as const)("projects legal selection context", (selection, expected) => {
    expect(canvasBrandColorTargetV1(selection)).toBe(expected);
  });
});
