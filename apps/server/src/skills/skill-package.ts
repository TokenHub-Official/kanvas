import { skillArchiveCrc32 } from "@kanvas/database/runtime";

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface ParsedSkillMarkdown {
  readonly name: string;
  readonly description: string;
  readonly bodyMarkdown: string;
}

function fail(message: string): never {
  throw new TypeError(message);
}

function scalar(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fail(`Skill ${label} is required.`);
  if (trimmed.startsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed) as unknown;
      if (typeof decoded !== "string")
        return fail(`Skill ${label} is invalid.`);
      return decoded.trim();
    } catch {
      return fail(`Skill ${label} is invalid.`);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'").trim();
  }
  return trimmed.replace(/\s+#.*$/u, "").trim();
}

export function validateSkillPackageName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80 || !namePattern.test(name)) {
    return fail("Skill name must use lowercase letters, digits and hyphens.");
  }
  return name;
}

export function renderSkillMarkdown(options: {
  readonly name: string;
  readonly description: string;
  readonly bodyMarkdown: string;
}): string {
  const name = validateSkillPackageName(options.name);
  const description = options.description.trim();
  const body = options.bodyMarkdown.trim();
  if (
    description.length < 1 ||
    description.length > 600 ||
    /[\r\n]/u.test(description)
  ) {
    return fail(
      "Skill description must be one line between 1 and 600 characters.",
    );
  }
  if (body.length < 1 || body.length > 262_144) {
    return fail(
      "Skill instructions must contain between 1 and 262144 characters.",
    );
  }
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
}

export function parseSkillMarkdown(bytes: Uint8Array): ParsedSkillMarkdown {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("SKILL.md must be valid UTF-8 text.");
  }
  const normalized = content.replaceAll("\r\n", "\n").trimStart();
  if (!normalized.startsWith("---\n")) {
    return fail("SKILL.md must start with YAML frontmatter.");
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) return fail("SKILL.md frontmatter is not closed.");
  const lines = normalized.slice(4, closing).split("\n");
  let name = "";
  let description = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) continue;
    const key = match[1]?.toLowerCase();
    const raw = match[2] ?? "";
    if (key === "name") name = scalar(raw, "name");
    if (key === "description") {
      if (raw === "|" || raw === ">" || raw === "|-" || raw === ">-") {
        const values: string[] = [];
        while ((lines[index + 1] ?? "").startsWith("  ")) {
          index += 1;
          values.push((lines[index] ?? "").slice(2));
        }
        description = values.join(raw.startsWith(">") ? " " : "\n").trim();
      } else {
        description = scalar(raw, "description");
      }
    }
  }
  name = validateSkillPackageName(name);
  if (description.length < 1 || description.length > 600) {
    return fail("Skill description must contain between 1 and 600 characters.");
  }
  const bodyMarkdown = normalized.slice(closing + 5).trim();
  if (bodyMarkdown.length < 1 || bodyMarkdown.length > 262_144) {
    return fail("SKILL.md body must contain between 1 and 262144 characters.");
  }
  return Object.freeze({ name, description, bodyMarkdown });
}

export function titleFromSkillBody(
  bodyMarkdown: string,
  fallback: string,
): string {
  const heading = /^#\s+(.+)$/mu.exec(bodyMarkdown)?.[1]?.trim();
  return (heading || fallback).slice(0, 160);
}

export function buildSkillZip(
  entries: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const name = Buffer.from(entry.path, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const crc = skillArchiveCrc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.byteLength, 18);
    local.writeUInt32LE(bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.byteLength, 20);
    central.writeUInt32LE(bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + bytes.byteLength;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}
