import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import type {
  AgentSkillCatalogItem,
  AgentSkillInstructionResource,
  StorageProfileRegistry,
} from "@kanvas/application";

// Backward-compatible fallback for callers without a pinned Agent Profile.
const defaultSkillReadBytes = 262_144;

export interface LoadedAgentSkillInstructions {
  readonly skillRevisionId: string;
  readonly displayName: string;
  readonly contentDigest: string;
  readonly markdown: string;
}

export class AgentSkillInstructionLoaderError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "AgentSkillInstructionLoaderError";
  }
}

async function loadResource(
  profiles: StorageProfileRegistry,
  resource: AgentSkillInstructionResource,
  signal?: AbortSignal,
  maximumBytes = defaultSkillReadBytes,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const maximum = Number(resource.byteSize);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maximumBytes)
    throw new AgentSkillInstructionLoaderError(
      "agent.skill_instruction_too_large",
    );
  let bytes: Buffer;
  if (resource.developmentLocalPath) {
    const handle = await open(resource.developmentLocalPath, "r").catch(() => {
      throw new AgentSkillInstructionLoaderError(
        "agent.skill_instruction_unavailable",
      );
    });
    try {
      const before = await handle.stat({ bigint: true });
      bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs
      ) {
        throw new AgentSkillInstructionLoaderError(
          "agent.skill_instruction_changed",
        );
      }
    } finally {
      await handle.close();
    }
  } else {
    const profile = profiles.resolve(resource.storageProfileId);
    if (!profile) {
      throw new AgentSkillInstructionLoaderError(
        "agent.skill_storage_profile_unavailable",
      );
    }
    const read = await profile.adapter.openRead({
      identity: {
        storageProfileId: resource.storageProfileId,
        container: resource.container,
        objectKey: resource.objectKey,
      },
      expectedByteSize: resource.byteSize,
      expectedSha256: resource.sha256,
      expectedImmutableIdentityHash: resource.immutableIdentityHash,
    });
    if (
      read.totalByteSize !== resource.byteSize ||
      read.contentByteSize !== resource.byteSize ||
      read.range !== undefined
    ) {
      throw new AgentSkillInstructionLoaderError(
        "agent.skill_storage_identity_mismatch",
      );
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of read.body) {
      signal?.throwIfAborted();
      size += chunk.byteLength;
      if (size > maximum || size > maximumBytes) {
        throw new AgentSkillInstructionLoaderError(
          "agent.skill_instruction_too_large",
        );
      }
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }
  const size = bytes.byteLength;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    size !== maximum ||
    size > maximumBytes ||
    sha256 !== resource.sha256 ||
    resource.contentDigest !== `sha256:${sha256}`
  ) {
    throw new AgentSkillInstructionLoaderError(
      "agent.skill_instruction_digest_mismatch",
    );
  }
  return bytes;
}

async function loadTextResource(
  profiles: StorageProfileRegistry,
  resource: AgentSkillInstructionResource,
  signal?: AbortSignal,
  maximumBytes = defaultSkillReadBytes,
): Promise<string> {
  const bytes = await loadResource(profiles, resource, signal, maximumBytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  if (text.length < 1 || text.includes("\u0000")) {
    throw new AgentSkillInstructionLoaderError(
      "agent.skill_instruction_invalid",
    );
  }
  return text;
}

export function createAgentSkillInstructionLoader(options: {
  readonly profiles: StorageProfileRegistry;
}) {
  return Object.freeze({
    async loadImage(
      skill: AgentSkillCatalogItem,
      path: string,
      signal?: AbortSignal,
    ) {
      const resource = skill.referenceResources.find(
        (item) => item.resourcePath === path,
      );
      if (
        !resource ||
        !["image/png", "image/jpeg", "image/webp"].includes(resource.mediaType)
      )
        throw new AgentSkillInstructionLoaderError(
          "agent.skill_image_unavailable",
        );
      const bytes = await loadResource(
        options.profiles,
        resource,
        signal,
        32 * 1024 * 1024,
      );
      return {
        resource,
        data: bytes.toString("base64"),
        mediaType: resource.mediaType,
      };
    },
    async load(
      skill: AgentSkillCatalogItem,
      signal?: AbortSignal,
      maximumBytes = defaultSkillReadBytes,
    ): Promise<LoadedAgentSkillInstructions> {
      const markdown = await loadTextResource(
        options.profiles,
        skill.instructionResource,
        signal,
        maximumBytes,
      );
      return Object.freeze({
        skillRevisionId: skill.skillRevisionId,
        displayName: skill.displayName,
        contentDigest: skill.instructionResource.contentDigest,
        markdown,
      });
    },
    async loadReference(
      skill: AgentSkillCatalogItem,
      relativePath: string,
      signal?: AbortSignal,
      maximumBytes = defaultSkillReadBytes,
    ): Promise<string | null> {
      const resource = skill.referenceResources.find(
        (candidate) => candidate.resourcePath === relativePath,
      );
      return resource
        ? loadTextResource(options.profiles, resource, signal, maximumBytes)
        : null;
    },
  });
}
