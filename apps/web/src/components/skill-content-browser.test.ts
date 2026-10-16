import { describe, expect, it, vi } from "vitest";
import { fetchSkillFile } from "../api/transport.js";
import {
  skillFileTree,
  skillFileDestination,
  skillMarkdownPreview,
  validNewSkillPath,
} from "./skill-content-browser.js";

describe("Skill files in the workbench", () => {
  it("renders frontmatter as YAML instead of a Markdown heading", () => {
    expect(
      skillMarkdownPreview("---\r\nname: example\r\n---\r\n# Instructions"),
    ).toBe("```yaml\nname: example\n```\n\n# Instructions");
    expect(skillMarkdownPreview("# Instructions\n\n---\nBody")).toBe(
      "# Instructions\n\n---\nBody",
    );
    expect(skillMarkdownPreview("---\nname: `example```\n---\nBody")).toBe(
      "````yaml\nname: `example```\n````\n\nBody",
    );
  });
  it("combines a chosen folder and nested filename without flattening directories", () => {
    const path = skillFileDestination("references", "xxx/yyy.jpg");
    expect(path).toBe("references/xxx/yyy.jpg");
    expect(validNewSkillPath(path)).toBe(true);
    expect(
      skillFileTree([path]).find((item) => item.key === "references")
        ?.children?.[0]?.children?.[0]?.key,
    ).toBe(path);
    expect(
      validNewSkillPath(skillFileDestination("references", "../yyy.jpg")),
    ).toBe(false);
    expect(
      validNewSkillPath(skillFileDestination("references", "/yyy.jpg")),
    ).toBe(false);
  });
  it.each([
    "SKILL.md/child.txt",
    "skill.md",
    "assets/a./b.jpg",
    "assets/a /b.jpg",
    `${"层".repeat(170)}.md`,
    `${"a/".repeat(12)}b.md`,
  ])(
    "rejects paths that cannot round-trip through a Skill archive: %s",
    (path) => {
      expect(validNewSkillPath(path)).toBe(false);
    },
  );
  it("preserves nested file identity while grouping shared folders", () => {
    const tree = skillFileTree([
      "scripts/a.py",
      "references/a.md",
      "scripts/b.py",
      "scripts/a.py",
    ]);
    expect(
      tree
        .find((node) => node.key === "scripts")
        ?.children?.map((node) => node.key),
    ).toEqual(["scripts/a.py", "scripts/b.py"]);
    expect(tree.find((node) => node.key === "SKILL.md")?.isLeaf).toBe(true);
  });
  it.each(["../file", "/file", "a//b", "C:/file", "SKILL.md", "kanvas.yaml"])(
    "rejects unsafe new path %s",
    (path) => expect(validNewSkillPath(path)).toBe(false),
  );
  it("pins draft reads to the displayed version and safely encodes file names", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("print('ok')", {
          headers: { "content-type": "text/x-python" },
        }),
      ),
    );
    const result = await fetchSkillFile(
      "workspace",
      { kind: "draft", id: "draft", version: 3 },
      "scripts/a & b.py",
      fetcher,
    );
    expect(await result.text()).toBe("print('ok')");
    const requestedUrl = fetcher.mock.calls[0]?.[0];
    if (typeof requestedUrl !== "string")
      throw new Error("Expected a relative file URL.");
    const url = new URL(requestedUrl, "http://localhost");
    expect(url.pathname).toBe(
      "/api/v1/workspaces/workspace/skill-drafts/draft/files",
    );
    expect(url.searchParams.get("path")).toBe("scripts/a & b.py");
    expect(url.searchParams.get("draftVersion")).toBe("3");
  });
});
