import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryTextContent } from "./library-content.js";
import { LibraryUseReferences } from "./library-use-references.js";
import "../../i18n/i18n.js";

describe("Library reference presentation", () => {
  it("renders readable Markdown without external media, active links or raw HTML", () => {
    const markup = renderToStaticMarkup(
      <LibraryTextContent
        markdown
        text={
          '# Product\n\n**Lightweight**\n\n![remote](https://example.com/track.png)\n\n[Read more](https://example.com)\n\n<img src="https://example.com/raw.png" onerror="alert(1)"><script>alert(1)</script>'
        }
      />,
    );
    expect(markup).toContain("<h1");
    expect(markup).toContain('data-streamdown="strong"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<script");
    expect(markup).not.toMatch(/(?:src|href)="https:\/\//u);
  });
  it("keeps plain text literal and groups repeated uses only within the same revision", () => {
    expect(
      renderToStaticMarkup(
        <LibraryTextContent markdown={false} text={"<b>literal</b>"} />,
      ),
    ).toContain("&lt;b&gt;literal&lt;/b&gt;");
    const entry = {
      libraryId: "01K00000000000000000000001",
      entryId: "01K00000000000000000000002",
      libraryName: "Product references",
      name: "photo.png",
      revisionNumber: 3,
    };
    const markup = renderToStaticMarkup(
      <LibraryUseReferences
        uses={[
          { ...entry, kind: "image_view" },
          { ...entry, kind: "tool_input" },
          { ...entry, revisionNumber: 4, kind: "image_view" },
        ]}
      />,
    );
    expect(markup.match(/>photo\.png<\/button>/g)).toHaveLength(2);
    expect(markup).not.toContain("libraries.useKind");
  });
});
