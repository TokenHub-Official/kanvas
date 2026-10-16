import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  inspectAndExtractSkillPackageArchive,
  skillArchiveCrc32,
} from "../src/runtime/skill-package-archive.js";
import type { SkillPackageArchiveError } from "../src/runtime/skill-package-archive.js";

interface ZipFixtureEntry {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly compression?: 0 | 8;
  readonly flags?: number;
  readonly rawName?: Buffer;
  readonly extra?: Buffer;
}

function zipFixture(entries: readonly ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = entry.rawName ?? Buffer.from(entry.path, "utf8");
    const extra = entry.extra ?? Buffer.alloc(0);
    const content =
      typeof entry.content === "string"
        ? Buffer.from(entry.content, "utf8")
        : Buffer.from(entry.content);
    const compression = entry.compression ?? 0;
    const compressed = compression === 0 ? content : deflateRawSync(content);
    const flags = entry.flags ?? 0x0800;
    const crc32 = skillArchiveCrc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compression, 8);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    localParts.push(local, name, extra, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compression, 10);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    central.writeUInt16LE(extra.length, 30);
    centralParts.push(central, name, extra);
    localOffset +=
      local.length + name.length + extra.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

const baseEntries = Object.freeze([
  Object.freeze({
    path: "SKILL.md",
    content: "# Product foundation\nUse approved workflows.",
  }),
  Object.freeze({
    path: "kanvas.yaml",
    content: "schemaVersion: 1\nkey: product-foundation\n",
  }),
  Object.freeze({
    path: "workflows/default.json",
    content: JSON.stringify({
      workflowRevisionId: "01J00000000000000000000001",
    }),
  }),
]);

describe("restricted Skill package ZIP profile", () => {
  it("extracts bounded ordinary files and derives an order-independent digest", () => {
    const first = inspectAndExtractSkillPackageArchive(zipFixture(baseEntries));
    const second = inspectAndExtractSkillPackageArchive(
      zipFixture([...baseEntries].reverse()),
    );

    expect(first.entries.map(({ path }) => path)).toEqual([
      "SKILL.md",
      "kanvas.yaml",
      "workflows/default.json",
    ]);
    expect(first.logicalPackageDigest).toBe(second.logicalPackageDigest);
    expect(first.archiveSha256).not.toBe(second.archiveSha256);
    expect(first.entries[0]?.mediaType).toBe("text/markdown");
  });

  it.each([
    {
      label: "Zip Slip",
      entries: [
        ...baseEntries,
        {
          path: "../escape.md",
          content: "escape",
        },
      ],
      code: "skill_archive.path_rejected",
    },
    {
      label: "compiled binary",
      entries: [
        ...baseEntries,
        {
          path: "scripts/install.exe",
          content: "process.exit(0)",
        },
      ],
      code: "skill_archive.content_rejected",
    },
    {
      label: "case collision",
      entries: [
        ...baseEntries,
        {
          path: "skill.md",
          content: "collision",
        },
      ],
      code: "skill_archive.path_rejected",
    },
    {
      label: "data descriptor",
      entries: [
        {
          ...baseEntries[0]!,
          flags: 0x0808,
        },
        ...baseEntries.slice(1),
      ],
      code: "skill_archive.entry_rejected",
    },
  ])("rejects $label before content adoption", ({ entries, code }) => {
    expect(() =>
      inspectAndExtractSkillPackageArchive(zipFixture(entries)),
    ).toThrow(
      expect.objectContaining({
        code,
      }) as SkillPackageArchiveError,
    );
  });

  it("imports a wrapped source package with unflagged UTF-8 and keeps script bytes", () => {
    const archive = inspectAndExtractSkillPackageArchive(
      zipFixture([
        { path: "solar/SKILL.md", content: "# Solar" },
        { path: "solar/assets/清明.md", content: "reference", flags: 0 },
        {
          path: "solar/scripts/compose.py",
          content: "print('retained, not executed')",
        },
        { path: "__MACOSX/._SKILL.md", content: "metadata" },
      ]),
    );
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "assets/清明.md",
      "scripts/compose.py",
    ]);
    expect(Buffer.from(archive.entries[2]!.bytes).toString()).toBe(
      "print('retained, not executed')",
    );
  });

  it("supports CP437 by default and explicit GBK filenames", () => {
    const legacy = inspectAndExtractSkillPackageArchive(
      zipFixture([
        ...baseEntries,
        {
          path: "",
          rawName: Buffer.from([0x82, 0x2e, 0x6d, 0x64]),
          flags: 0,
          content: "cafe",
        },
      ]),
    );
    expect(legacy.entries.some((entry) => entry.path === "é.md")).toBe(true);
    const gbk = inspectAndExtractSkillPackageArchive(
      zipFixture([
        ...baseEntries,
        {
          path: "",
          rawName: Buffer.from([0xc7, 0xe5, 0xc3, 0xf7, 0x2e, 0x6d, 0x64]),
          flags: 0,
          content: "qingming",
        },
      ]),
      undefined,
      "gb18030",
    );
    expect(gbk.entries.some((entry) => entry.path === "清明.md")).toBe(true);
  });

  it.each([
    { encoding: "big5" as const, bytes: [178, 77, 169, 250, 46, 109, 100] },
    {
      encoding: "shift_jis" as const,
      bytes: [144, 180, 150, 190, 46, 109, 100],
    },
  ])(
    "decodes explicitly selected $encoding filenames",
    ({ encoding, bytes }) => {
      const archive = inspectAndExtractSkillPackageArchive(
        zipFixture([
          ...baseEntries,
          {
            path: "",
            rawName: Buffer.from(bytes),
            flags: 0,
            content: "reference",
          },
        ]),
        undefined,
        encoding,
      );
      expect(archive.entries.some((entry) => entry.path === "清明.md")).toBe(
        true,
      );
    },
  );

  it("honors CRC-validated Unicode Path metadata", () => {
    const rawName = Buffer.from("legacy.md");
    const unicodeName = Buffer.from("清明.md");
    const extra = Buffer.alloc(9 + unicodeName.length);
    extra.writeUInt16LE(0x7075, 0);
    extra.writeUInt16LE(5 + unicodeName.length, 2);
    extra[4] = 1;
    extra.writeUInt32LE(skillArchiveCrc32(rawName), 5);
    unicodeName.copy(extra, 9);
    const archive = inspectAndExtractSkillPackageArchive(
      zipFixture([
        ...baseEntries,
        { path: "", rawName, extra, flags: 0, content: "reference" },
      ]),
    );
    expect(archive.entries.some((entry) => entry.path === "清明.md")).toBe(
      true,
    );
  });

  it("rejects ambiguous Skill roots and normalization collisions", () => {
    expect(() =>
      inspectAndExtractSkillPackageArchive(
        zipFixture([
          { path: "one/SKILL.md", content: "one" },
          { path: "two/SKILL.md", content: "two" },
        ]),
      ),
    ).toThrow(
      expect.objectContaining({ code: "skill_archive.multiple_skills" }),
    );
    expect(() =>
      inspectAndExtractSkillPackageArchive(
        zipFixture([
          ...baseEntries,
          { path: "é.md", content: "one" },
          { path: "e\u0301.md", content: "two" },
        ]),
      ),
    ).toThrow(expect.objectContaining({ code: "skill_archive.path_rejected" }));
  });

  it("rejects a compressed bomb from inventory before extraction", () => {
    const archive = zipFixture([
      ...baseEntries,
      {
        path: "references/bomb.md",
        content: "a".repeat(100_000),
        compression: 8,
      },
    ]);

    expect(() =>
      inspectAndExtractSkillPackageArchive(archive, {
        maximumCompressionRatio: 10,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "skill_archive.limit_exceeded",
      }) as SkillPackageArchiveError,
    );
  });

  it("rejects CRC and content tampering", () => {
    const archive = zipFixture(baseEntries);
    const marker = archive.indexOf(Buffer.from("# Product foundation", "utf8"));
    expect(marker).toBeGreaterThan(0);
    archive[marker] = 0x21;

    expect(() => inspectAndExtractSkillPackageArchive(archive)).toThrow(
      expect.objectContaining({
        code: "skill_archive.content_rejected",
      }) as SkillPackageArchiveError,
    );
  });
});
