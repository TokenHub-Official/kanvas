import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentSkillCatalogItem,
  StoragePort,
  StorageProfileRegistry,
} from "@kanvas/application";
import { describe, expect, it } from "vitest";

import {
  AgentSkillInstructionLoaderError,
  createAgentSkillInstructionLoader,
} from "../src/agent/agent-skill-instruction-loader.js";

const markdown = Buffer.from(
  "# Runtime Skill\n\nUse the published Workflow Entrypoint after validating required inputs.",
  "utf8",
);
const sha256 = createHash("sha256").update(markdown).digest("hex");
const skill = {
  skillDefinitionId: "01K00000000000000000000004",
  skillRevisionId: "01K00000000000000000000001",
  skillKey: "workspace.runtime-skill",
  skillName: "workspace-runtime-skill",
  revision: 1,
  bound: true,
  displayName: "Runtime Skill",
  summary: "A runtime-loaded Skill unknown to the Worker build.",
  exampleRequests: [],
  toolFamilies: ["workflow"],
  canonicalDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  instructionResource: {
    resourcePath: "SKILL.md",
    storedObjectId: "01K00000000000000000000002",
    storageProfileId: "01K00000000000000000000003",
    container: "skills",
    objectKey: "workspace.runtime-skill/SKILL.md",
    sha256,
    immutableIdentityHash:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    contentDigest: `sha256:${sha256}`,
    mediaType: "text/markdown",
    byteSize: String(markdown.byteLength),
  },
  referenceResources: [],
  entrypoints: [],
} satisfies AgentSkillCatalogItem;

function registry(body: Uint8Array): StorageProfileRegistry {
  const adapter = {
    storageProfileId: skill.instructionResource.storageProfileId,
    openRead: () =>
      Promise.resolve({
        identity: {
          storageProfileId: skill.instructionResource.storageProfileId,
          container: skill.instructionResource.container,
          objectKey: skill.instructionResource.objectKey,
        },
        totalByteSize: String(body.byteLength),
        contentByteSize: String(body.byteLength),
        body: (async function* () {
          await Promise.resolve();
          yield body;
        })(),
      }),
  } as unknown as StoragePort;
  return {
    resolve: (storageProfileId) =>
      storageProfileId === adapter.storageProfileId
        ? { storageProfileId, kind: "local", adapter }
        : undefined,
  };
}

describe("Agent Skill instruction loader", () => {
  it("honors the profile read budget rather than an inner fixed cap", async () => {
    const bytes = Buffer.from("Fact. ".repeat(60000));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const resource = {
      ...skill.instructionResource,
      byteSize: String(bytes.length),
      sha256: hash,
      contentDigest: `sha256:${hash}`,
    };
    const item = {
      ...skill,
      instructionResource: resource,
      referenceResources: [
        {
          ...resource,
          resourcePath: "references/large.md",
          relativePath: "large.md",
        },
      ],
    };
    const loader = createAgentSkillInstructionLoader({
      profiles: registry(bytes),
    });
    await expect(loader.load(item)).rejects.toThrow(
      "agent.skill_instruction_too_large",
    );
    expect((await loader.load(item, undefined, 1048576)).markdown.length).toBe(
      bytes.toString().trim().length,
    );
    expect(
      (
        await loader.loadReference(
          item,
          "references/large.md",
          undefined,
          1048576,
        )
      )?.length,
    ).toBe(bytes.toString().trim().length);
    await expect(
      loader.loadReference(item, "references/large.md", undefined, 0),
    ).rejects.toThrow("agent.skill_instruction_too_large");
  });

  it("reads an image as pinned bytes without decoding it as UTF-8", async () => {
    const bytes = Buffer.from([255, 216, 255, 224, 255, 217]);
    const imageDigest = createHash("sha256").update(bytes).digest("hex");
    const imageSkill = {
      ...skill,
      referenceResources: [
        {
          ...skill.instructionResource,
          resourcePath: "references/xxx/yyy.jpg",
          relativePath: "xxx/yyy.jpg",
          mediaType: "image/jpeg",
          byteSize: String(bytes.length),
          sha256: imageDigest,
          contentDigest: `sha256:${imageDigest}`,
        },
      ],
    };
    const loader = createAgentSkillInstructionLoader({
      profiles: registry(bytes),
    });
    await expect(
      loader.loadImage(imageSkill, "references/xxx/yyy.jpg"),
    ).resolves.toMatchObject({
      mediaType: "image/jpeg",
      data: bytes.toString("base64"),
    });
    await expect(
      loader.loadImage(imageSkill, "scripts/run.py"),
    ).rejects.toThrow("agent.skill_image_unavailable");
  });
  it("reads an exact nested text path and rejects altered pinned bytes", async () => {
    const item = {
      ...skill,
      referenceResources: [
        {
          ...skill.instructionResource,
          relativePath: "xxx/guide.md",
          resourcePath: "references/xxx/guide.md",
        },
      ],
    };
    const loader = createAgentSkillInstructionLoader({
      profiles: registry(markdown),
    });
    expect(await loader.loadReference(item, "references/xxx/guide.md")).toBe(
      markdown.toString("utf8"),
    );
    expect(
      await loader.loadReference(item, "references/missing.md"),
    ).toBeNull();
    const changed = Buffer.from(markdown);
    changed[0] = 33;
    await expect(
      createAgentSkillInstructionLoader({
        profiles: registry(changed),
      }).loadReference(item, "references/xxx/guide.md"),
    ).rejects.toThrow("agent.skill_instruction_digest_mismatch");
  });
  it("loads digest-pinned instructions through the configured Storage profile", async () => {
    const loader = createAgentSkillInstructionLoader({
      profiles: registry(markdown),
    });
    await expect(loader.load(skill)).resolves.toEqual({
      skillRevisionId: skill.skillRevisionId,
      displayName: "Runtime Skill",
      contentDigest: skill.instructionResource.contentDigest,
      markdown: markdown.toString("utf8"),
    });
  });

  it("rejects changed bytes even when the resource identity is reused", async () => {
    const loader = createAgentSkillInstructionLoader({
      profiles: registry(Buffer.from("changed", "utf8")),
    });
    await expect(loader.load(skill)).rejects.toEqual(
      new AgentSkillInstructionLoaderError(
        "agent.skill_storage_identity_mismatch",
      ),
    );
  });

  it("reads a digest-pinned local file without Storage in development", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kanvas-agent-skill-"));
    const path = join(directory, "SKILL.md");
    await writeFile(path, markdown);
    try {
      const loader = createAgentSkillInstructionLoader({
        profiles: { resolve: () => undefined },
      });
      await expect(
        loader.load({
          ...skill,
          instructionResource: {
            ...skill.instructionResource,
            developmentLocalPath: path,
          },
        }),
      ).resolves.toMatchObject({ markdown: markdown.toString("utf8") });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
