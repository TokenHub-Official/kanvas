import "fake-indexeddb/auto";
import Database from "emoji-picker-element/database";
import { expect, it, vi } from "vitest";

it("indexes and finds a single Chinese character without unrelated results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              annotation: "测试动物",
              tags: ["猫"],
              emoji: "🐱",
              order: 1,
              group: 3,
              version: 1,
            },
            {
              annotation: "另一动物",
              tags: ["狗"],
              emoji: "🐶",
              order: 2,
              group: 3,
              version: 1,
            },
          ]),
          { headers: { etag: "cjk-search-test" } },
        ),
      ),
    ),
  );
  const database = new Database({
    locale: "kanvas-avatar-test",
    dataSource: "/emoji-test.json",
  });
  try {
    const results = await database.getEmojiBySearchQuery("猫");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ unicode: "🐱" });
  } finally {
    await database.delete();
    vi.unstubAllGlobals();
  }
});
