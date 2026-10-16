import {
  parseAgentProfileManifestV1,
  type AgentProfileManifestV1,
} from "./agent-foundation.js";
import type { AgentSurfaceKind } from "./agent-runtime.js";

export interface AgentFoundationPackProfileV1 {
  readonly profileKey: string;
  readonly revision: number;
  readonly surfaceBindings: readonly AgentSurfaceKind[];
  readonly manifest: AgentProfileManifestV1;
}

export interface AgentFoundationPackSkillV1 {
  readonly manifestPath: string;
  readonly instructionRootPath: string;
  readonly workflowEntrypoints: readonly {
    readonly entrypointKey: string;
    readonly workflowKey: string;
  }[];
}

export interface AgentFoundationPackV1 {
  readonly schemaVersion: 1;
  readonly packKey: string;
  readonly profiles: readonly AgentFoundationPackProfileV1[];
  readonly skills: readonly AgentFoundationPackSkillV1[];
}

const surfaceKinds = new Set<AgentSurfaceKind>([
  "agent_workspace",
  "workspace_home",
  "canvas",
  "asset",
  "workflow_run",
  "workflow_authoring",
  "brand",
]);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function key(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length <= maximum &&
    /^[a-z0-9][a-z0-9._-]*$/u.test(value)
    ? value
    : undefined;
}

function relativePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 500 ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    return undefined;
  }
  return value;
}

function parseProfile(
  value: unknown,
): AgentFoundationPackProfileV1 | undefined {
  const candidate = record(value);
  const profileKey = key(candidate?.profileKey, 160);
  const revision = candidate?.revision;
  const bindings = candidate?.surfaceBindings;
  const manifest = parseAgentProfileManifestV1(candidate?.manifest);
  if (
    !profileKey ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Array.isArray(bindings) ||
    bindings.length < 1 ||
    bindings.length > surfaceKinds.size ||
    !bindings.every(
      (surface): surface is AgentSurfaceKind =>
        typeof surface === "string" &&
        surfaceKinds.has(surface as AgentSurfaceKind),
    ) ||
    new Set(bindings).size !== bindings.length ||
    !manifest ||
    bindings.some((surface) => !manifest.allowedSurfaceKinds.includes(surface))
  ) {
    return undefined;
  }
  return Object.freeze({
    profileKey,
    revision,
    surfaceBindings: Object.freeze([...bindings]),
    manifest,
  });
}

function parseSkill(value: unknown): AgentFoundationPackSkillV1 | undefined {
  const candidate = record(value);
  const manifestPath = relativePath(candidate?.manifestPath);
  const instructionRootPath = relativePath(candidate?.instructionRootPath);
  if (
    !manifestPath ||
    !instructionRootPath ||
    !Array.isArray(candidate?.workflowEntrypoints) ||
    candidate.workflowEntrypoints.length > 20
  ) {
    return undefined;
  }
  const workflowEntrypoints = candidate.workflowEntrypoints.map((value) => {
    const entrypoint = record(value);
    const entrypointKey = key(entrypoint?.entrypointKey, 160);
    const workflowKey = key(entrypoint?.workflowKey, 160);
    return entrypointKey && workflowKey
      ? Object.freeze({ entrypointKey, workflowKey })
      : undefined;
  });
  if (
    workflowEntrypoints.some((entrypoint) => entrypoint === undefined) ||
    new Set(workflowEntrypoints.map((entrypoint) => entrypoint?.entrypointKey))
      .size !== workflowEntrypoints.length
  ) {
    return undefined;
  }
  return Object.freeze({
    manifestPath,
    instructionRootPath,
    workflowEntrypoints: Object.freeze(
      workflowEntrypoints as {
        readonly entrypointKey: string;
        readonly workflowKey: string;
      }[],
    ),
  });
}

export function parseAgentFoundationPackV1(
  value: unknown,
): AgentFoundationPackV1 | undefined {
  const candidate = record(value);
  const packKey = key(candidate?.packKey, 160);
  if (
    candidate?.schemaVersion !== 1 ||
    !packKey ||
    !Array.isArray(candidate.profiles) ||
    candidate.profiles.length < 1 ||
    candidate.profiles.length > 20 ||
    !Array.isArray(candidate.skills) ||
    candidate.skills.length > 200
  ) {
    return undefined;
  }
  const profiles = candidate.profiles.map(parseProfile);
  const skills = candidate.skills.map(parseSkill);
  if (
    profiles.some((profile) => profile === undefined) ||
    skills.some((skill) => skill === undefined)
  ) {
    return undefined;
  }
  const parsedProfiles = profiles as AgentFoundationPackProfileV1[];
  const parsedSkills = skills as AgentFoundationPackSkillV1[];
  if (
    new Set(
      parsedProfiles.map(
        (profile) => `${profile.profileKey}:${String(profile.revision)}`,
      ),
    ).size !== parsedProfiles.length ||
    new Set(parsedProfiles.flatMap((profile) => profile.surfaceBindings))
      .size !==
      parsedProfiles.flatMap((profile) => profile.surfaceBindings).length ||
    new Set(parsedSkills.map((skill) => skill.manifestPath)).size !==
      parsedSkills.length
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    packKey,
    profiles: Object.freeze(parsedProfiles),
    skills: Object.freeze(parsedSkills),
  });
}
