import assert from "node:assert/strict";
import test from "node:test";

import { localMarkdownTarget } from "./check-doc-links.mjs";

test("keeps local Markdown paths and ignores external or same-page links", () => {
  assert.equal(localMarkdownTarget("docs/README.md#start"), "docs/README.md");
  assert.equal(localMarkdownTarget("<My%20Document.md>"), "My Document.md");
  assert.equal(localMarkdownTarget("https://example.com/docs"), undefined);
  assert.equal(localMarkdownTarget("#configuration"), undefined);
});
