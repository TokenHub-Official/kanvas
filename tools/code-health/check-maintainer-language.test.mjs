import assert from "node:assert/strict";
import test from "node:test";

import { commentsWithHan, hanLines } from "./check-maintainer-language.mjs";

test("reports Han text by line", () => {
  assert.deepEqual(hanLines("English\n中文\nEnglish"), [2]);
});

test("checks comments without treating localized string data as comments", () => {
  const contents = [
    'const label = "中文";',
    "// English comment",
    "/* 中文注释 */",
  ].join("\n");
  assert.deepEqual(commentsWithHan(contents, ".ts"), [3]);
});
