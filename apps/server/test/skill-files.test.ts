import { describe, expect, it } from "vitest";
import type {
  SkillPublicationDocumentV1,
  SkillPublicationResourceV1,
} from "@kanvas/database/runtime";
import {
  decodeSkillFile,
  mergeSkillFiles,
  validateSkillFilePaths,
  validateEditableSkillPath,
} from "../src/skills/skill-files.js";

function resource(
  path: string,
  storedObjectId: string,
): SkillPublicationResourceV1 {
  return {
    path,
    storedObjectId,
    resourceKind: path === "SKILL.md" ? "instructions" : "reference",
    contentDigest: `sha256:${"a".repeat(64)}`,
    mediaType: "text/plain",
    byteSize: 12,
  };
}
describe("Skill file changes", () => {
  it("accepts nested resources but rejects file-folder and case collisions", () => {
    expect(validateEditableSkillPath("references/xxx/yyy.jpg")).toBe(
      "references/xxx/yyy.jpg",
    );
    expect(() =>
      validateSkillFilePaths([
        "SKILL.md",
        "references/xxx/yyy.jpg",
        "assets/xxx/yyy.jpg",
      ]),
    ).not.toThrow();
    for (const paths of [
      ["references/xxx", "references/xxx/yyy.jpg"],
      ["references/XXX", "references/xxx/yyy.jpg"],
      ["references/a.md", "references/A.md"],
    ]) {
      expect(() => validateSkillFilePaths(paths)).toThrow();
    }
    const document: SkillPublicationDocumentV1 = {
      schemaVersion: 1,
      manifest: {},
      resources: [resource("references/xxx", "old")],
      workflowEntrypoints: [],
    };
    expect(() =>
      mergeSkillFiles(document, [resource("references/xxx/yyy.jpg", "new")]),
    ).toThrow();
    expect(
      mergeSkillFiles(
        document,
        [resource("references/xxx/yyy.jpg", "new")],
        ["references/xxx"],
      ).resources,
    ).toHaveLength(1);
  });
  it("preserves untouched attachments and workflow entrypoints while changing, adding and removing files", () => {
    const instructions = resource("SKILL.md", "original-instructions");
    const reference = resource("references/guide.md", "original-reference");
    const image = {
      ...resource("assets/cover.png", "original-image"),
      mediaType: "image/png",
    };
    const document: SkillPublicationDocumentV1 = {
      schemaVersion: 1,
      manifest: {
        agent: { instructionResourcePath: "SKILL.md" },
        entrypoints: [{ entrypointKey: "make" }],
      },
      resources: [instructions, reference, image],
      workflowEntrypoints: [
        {
          entrypointKey: "make",
          workflowRevisionId: "01K00000000000000000000001",
        },
      ],
    };
    const replacement = resource("SKILL.md", "new-instructions");
    const script = resource("scripts/check.py", "new-script");
    const merged = mergeSkillFiles(
      document,
      [replacement, script],
      [reference.path],
    );
    expect(merged.resources).toEqual([replacement, image, script]);
    expect(merged.resources[1]).toBe(image);
    expect(merged.manifest).toBe(document.manifest);
    expect(merged.workflowEntrypoints).toBe(document.workflowEntrypoints);
    expect(document.resources).toEqual([instructions, reference, image]);
  });
  it.each([
    "../secret",
    "SKILL.md/child.txt",
    "skill.md",
    "assets/a./b.jpg",
    "assets/a /b.jpg",
    "assets/cafe\u0301.md",
    `${"层".repeat(170)}.md`,
    `${"a/".repeat(12)}b.md`,
    "/secret",
    "scripts/../../secret",
    "C:/secret",
    "scripts\\file.py",
    "scripts//file.py",
    "SKILL.md",
    "kanvas.yaml",
    "references/\u0000bad",
  ])("rejects invalid or reserved resource path %s", (path) => {
    expect(() => validateEditableSkillPath(path)).toThrow();
  });
  it("decodes text and canonical binary content without executing it", () => {
    expect(
      decodeSkillFile({ path: "scripts/check.py", text: "print('ok')\n" }),
    ).toMatchObject({
      mediaType: "text/x-python",
      bytes: Buffer.from("print('ok')\n"),
    });
    expect(
      decodeSkillFile({ path: "assets/test.bin", base64: "AQID" }).bytes,
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(() =>
      decodeSkillFile({ path: "assets/test.png", base64: "AQID" }),
    ).toThrow();
    expect(() =>
      decodeSkillFile({ path: "assets/test.png", base64: "AQID!" }),
    ).toThrow();
    expect(() =>
      decodeSkillFile({ path: "references/empty.md", text: "" }),
    ).toThrow();
  });
  it("rejects ambiguous updates", () => {
    const file = resource("references/guide.md", "one");
    const document: SkillPublicationDocumentV1 = {
      schemaVersion: 1,
      manifest: {},
      resources: [file],
      workflowEntrypoints: [],
    };
    expect(() => mergeSkillFiles(document, [file], [file.path])).toThrow();
    expect(() => mergeSkillFiles(document, [file, file])).toThrow();
  });
});
