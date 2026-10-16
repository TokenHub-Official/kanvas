import type { CanvasDraftSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";
import { filterBoards } from "./boards-page.js";
import { validateBoardsSearch } from "./boards.js";

const base: CanvasDraftSummary = {
  id: "01K00000000000000000000000",
  workspaceId: "01K00000000000000000000000",
  title: "未命名画板",
  pageCount: 1,
  version: 1,
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
};
describe("board library", () => {
  it("preserves distinct boards with the same title and searches by brand", () => {
    const branded = {
      ...base,
      id: "01K00000000000000000000001",
      brand: {
        brandKitId: "01K00000000000000000000002",
        brandKitRevisionId: "01K00000000000000000000003",
        name: "Example Studio",
        revisionNumber: 1,
      },
    };
    expect(filterBoards([base, branded], "未命名")).toHaveLength(2);
    expect(filterBoards([base, branded], " example studio ")).toEqual([
      branded,
    ]);
    expect(filterBoards([base, branded], "missing")).toEqual([]);
  });
  it("normalizes search state for the return from the editor", () => {
    expect(validateBoardsSearch({ q: "  春季 海报  " })).toEqual({
      q: "春季 海报",
    });
    expect(validateBoardsSearch({ q: ["invalid"] })).toEqual({});
  });
});
