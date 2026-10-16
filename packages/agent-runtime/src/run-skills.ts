import { createSkillTools } from "@mastra/core/workspace";
import { createTool, type Tool } from "@mastra/core/tools";
import type {
  Skill,
  SkillMetadata,
  SkillSearchOptions,
  SkillSearchResult,
  WorkspaceSkills,
} from "@mastra/core/workspace";
import type { AgentSkillCatalogItem } from "@kanvas/application";

export type KanvasSkillUseSource = "bound" | "explicit" | "discovered";

export interface KanvasRunSkillInstructions {
  readonly skillRevisionId: string;
  readonly markdown: string;
}

export interface CreateKanvasRunSkillsOptions {
  readonly skills: readonly AgentSkillCatalogItem[];
  readonly explicitSkillRevisionId?: string;
  readonly maximumActivatedInstructionBytes: number;
  readonly maximumReferenceReadBytes: number;
  readonly loadInstructions: (
    skill: AgentSkillCatalogItem,
  ) => Promise<KanvasRunSkillInstructions>;
  readonly loadReference: (
    skill: AgentSkillCatalogItem,
    relativePath: string,
  ) => Promise<string | null>;
  readonly assertUsable: (skill: AgentSkillCatalogItem) => Promise<void>;
  readonly recordUse: (
    skill: AgentSkillCatalogItem,
    source: KanvasSkillUseSource,
  ) => Promise<void>;
}

function retainedSource(path: string): boolean {
  return (
    /(^|\/)scripts\//iu.test(path) ||
    /\.(?:py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|rb|php|pl|bat|cmd|ps1)$/iu.test(
      path,
    )
  );
}

function skillPath(skill: AgentSkillCatalogItem): string {
  return `skills/${skill.skillRevisionId}`;
}

function metadata(skill: AgentSkillCatalogItem): SkillMetadata {
  return Object.freeze({
    name: skill.skillName,
    path: skillPath(skill),
    description: skill.summary,
    metadata: Object.freeze({
      displayName: skill.displayName,
      skillKey: skill.skillKey,
      bound: skill.bound,
    }),
  });
}

function findSkill(
  skills: readonly AgentSkillCatalogItem[],
  identifier: string,
): AgentSkillCatalogItem | undefined {
  return skills.find(
    (skill) =>
      skill.skillName === identifier ||
      skill.skillKey === identifier ||
      skillPath(skill) === identifier ||
      `${skillPath(skill)}/SKILL.md` === identifier,
  );
}

function searchableText(skill: AgentSkillCatalogItem): string {
  return [
    skill.skillName,
    skill.skillKey,
    skill.displayName,
    skill.summary,
    ...skill.exampleRequests,
  ]
    .join("\n")
    .toLocaleLowerCase();
}

function searchScore(haystack: string, query: string): number {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return 0;
  if (haystack.includes(normalized)) return 1;
  const terms = normalized.split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return 0;
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

export function resolveSkillResource(
  skill: AgentSkillCatalogItem,
  path: string,
) {
  if (
    !path ||
    path.startsWith("/") ||
    /[\\:]|\p{Cc}/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  // Full paths are authoritative. Only unqualified reference paths have an alias.
  const resource =
    skill.referenceResources.find((item) => item.resourcePath === path) ??
    (!/^(?:references|assets|scripts)\//u.test(path)
      ? skill.referenceResources.find(
          (item) => item.resourcePath === `references/${path}`,
        )
      : undefined);
  return resource && !retainedSource(resource.resourcePath)
    ? resource
    : undefined;
}

export function createKanvasRunSkills(
  options: CreateKanvasRunSkillsOptions,
): WorkspaceSkills {
  const searched = new Set<string>();
  const activatedInstructions = new Map<string, number>();
  const readReferences = new Map<string, number>();
  const sourceFor = (skill: AgentSkillCatalogItem): KanvasSkillUseSource => {
    if (options.explicitSkillRevisionId === skill.skillRevisionId) {
      return "explicit";
    }
    return skill.bound ? "bound" : "discovered";
  };
  const beforeRead = async (skill: AgentSkillCatalogItem): Promise<void> => {
    await options.assertUsable(skill);
    await options.recordUse(skill, sourceFor(skill));
  };

  const registry: WorkspaceSkills = Object.freeze({
    list(): Promise<SkillMetadata[]> {
      return Promise.resolve(
        options.skills
          .filter(
            (skill) =>
              skill.bound ||
              options.explicitSkillRevisionId === skill.skillRevisionId,
          )
          .map(metadata),
      );
    },
    async get(identifier: string): Promise<Skill | null> {
      const skill = findSkill(options.skills, identifier);
      if (!skill) return null;
      await beforeRead(skill);
      const instructions = await options.loadInstructions(skill);
      if (instructions.skillRevisionId !== skill.skillRevisionId) {
        throw new Error("Kanvas Skill instructions do not match this Run.");
      }
      const markdown =
        instructions.markdown +
        (skill.referenceResources.length
          ? `\n\nResource paths relative to this Skill root (use these exact paths with skill_read):\n${skill.referenceResources
              .filter((resource) => !retainedSource(resource.resourcePath))
              .map((resource) => resource.resourcePath)
              .join("\n")}`
          : "") +
        (skill.referenceResources.some((resource) =>
          retainedSource(resource.resourcePath),
        )
          ? "\n\nKanvas runtime constraint: This package retains script source files for its owner. Scripts cannot be read or executed here. Do not claim to have run them. If a required step depends on scripts, explain the unavailable step and use an available tool only when it can actually perform that step; otherwise ask the user how to continue."
          : "");
      if (!activatedInstructions.has(skill.skillRevisionId)) {
        const bytes = new TextEncoder().encode(markdown).byteLength;
        const used = [...activatedInstructions.values()].reduce(
          (total, value) => total + value,
          0,
        );
        if (used + bytes > options.maximumActivatedInstructionBytes) {
          throw new Error(
            "The relevant Skills exceed this Agent's instruction budget. Use a more focused Skill or ask its owner to split the instructions.",
          );
        }
        activatedInstructions.set(skill.skillRevisionId, bytes);
      }
      return Object.freeze({
        ...metadata(skill),
        instructions: markdown,
        source: Object.freeze({
          type: "managed" as const,
          mastraPath: skillPath(skill),
        }),
        references: skill.referenceResources
          .filter(
            (resource) =>
              resource.resourcePath.startsWith("references/") &&
              !retainedSource(resource.resourcePath),
          )
          .map((resource) => resource.relativePath),
        scripts: [],
        assets: skill.referenceResources
          .filter(
            (resource) =>
              resource.resourcePath.startsWith("assets/") &&
              !retainedSource(resource.resourcePath),
          )
          .map((resource) => resource.resourcePath.slice("assets/".length)),
      });
    },
    has(identifier: string): Promise<boolean> {
      return Promise.resolve(
        findSkill(options.skills, identifier) !== undefined,
      );
    },
    async refresh(): Promise<void> {},
    async maybeRefresh(): Promise<void> {},
    search(
      query: string,
      searchOptions: SkillSearchOptions = {},
    ): Promise<SkillSearchResult[]> {
      const allowedNames = searchOptions.skillNames
        ? new Set(searchOptions.skillNames)
        : undefined;
      const topK = Math.max(1, Math.min(searchOptions.topK ?? 5, 20));
      const minimum = searchOptions.minScore ?? 0;
      const results = options.skills
        .filter(
          (skill) =>
            !allowedNames ||
            allowedNames.has(skill.skillName) ||
            allowedNames.has(skill.skillKey),
        )
        .map((skill) => ({
          skill,
          score: searchScore(searchableText(skill), query),
        }))
        .filter(({ score }) => score > 0 && score >= minimum)
        .toSorted(
          (left, right) =>
            right.score - left.score ||
            left.skill.skillKey.localeCompare(right.skill.skillKey),
        )
        .slice(0, topK);
      results.forEach(({ skill }) => searched.add(skill.skillRevisionId));
      return Promise.resolve(
        results.map(({ skill, score }) =>
          Object.freeze({
            skillName: skill.skillName,
            skillPath: skillPath(skill),
            source: "SKILL.md",
            content: `${skill.displayName}\n${skill.summary}`,
            score,
            metadata: Object.freeze({
              skillKey: skill.skillKey,
              bound: skill.bound,
              discovered: searched.has(skill.skillRevisionId),
            }),
          }),
        ),
      );
    },
    async getReference(
      identifier: string,
      path: string,
    ): Promise<string | null> {
      const skill = findSkill(options.skills, identifier);
      if (!skill) return null;
      const resource = resolveSkillResource(skill, path);
      if (!resource || resource.mediaType.startsWith("image/")) return null;
      await beforeRead(skill);
      const content = await options.loadReference(skill, resource.resourcePath);
      if (content === null) return null;
      const key = `${skill.skillRevisionId}:${resource.resourcePath}`;
      if (!readReferences.has(key)) {
        const bytes = new TextEncoder().encode(content).byteLength;
        const used = [...readReferences.values()].reduce(
          (total, value) => total + value,
          0,
        );
        if (used + bytes > options.maximumReferenceReadBytes) {
          throw new Error(
            "The requested Skill references exceed this Agent's reading budget. Read a smaller reference or ask the Skill owner to split it.",
          );
        }
        readReferences.set(key, bytes);
      }
      return content;
    },
    getScript(): Promise<null> {
      return Promise.resolve(null);
    },
    getAsset(): Promise<null> {
      return Promise.resolve(null);
    },
    listReferences(identifier: string): Promise<string[]> {
      const skill = findSkill(options.skills, identifier);
      return Promise.resolve(
        skill
          ? skill.referenceResources
              .filter(
                (resource) =>
                  resource.resourcePath.startsWith("references/") &&
                  !retainedSource(resource.resourcePath),
              )
              .map((resource) => resource.relativePath)
          : [],
      );
    },
    listScripts(): Promise<string[]> {
      return Promise.resolve([]);
    },
    listAssets(identifier: string): Promise<string[]> {
      const skill = findSkill(options.skills, identifier);
      return Promise.resolve(
        skill?.referenceResources
          .filter(
            (resource) =>
              resource.resourcePath.startsWith("assets/") &&
              !retainedSource(resource.resourcePath),
          )
          .map((resource) => resource.resourcePath.slice("assets/".length)) ??
          [],
      );
    },
  });
  return registry;
}

export interface KanvasRunSkillImage {
  readonly artifactId: string;
  readonly mediaType: string;
  readonly data: string;
}

export function createKanvasRunSkillTools(
  skills: WorkspaceSkills,
  readImage?: (
    name: string,
    path: string,
  ) => Promise<KanvasRunSkillImage | null>,
) {
  const tools: Record<string, Tool> = createSkillTools(skills);
  if (!readImage) return tools;
  const nativeRead = tools.skill_read as Tool<
    { skillName: string; path: string; startLine?: number; endLine?: number },
    unknown
  >;
  return {
    ...tools,
    skill_read: createTool({
      id: "skill_read",
      description:
        "Read a Skill reference or asset. Text is read with optional line bounds. PNG, JPEG and WebP images return the real image and an Artifact identifier usable in image tools. Scripts cannot be executed or read.",
      inputSchema: nativeRead.inputSchema!,
      execute: async (input, context) =>
        (await readImage(input.skillName, input.path)) ??
        (await nativeRead.execute!(input, context)),
      toModelOutput: (output: unknown) => {
        if (
          output &&
          typeof output === "object" &&
          "artifactId" in output &&
          "data" in output &&
          "mediaType" in output
        ) {
          const image = output as KanvasRunSkillImage;
          return {
            type: "content" as const,
            value: [
              {
                type: "text" as const,
                text: `Image Artifact: ${image.artifactId}. Use this exact artifactId for image tools.`,
              },
              {
                type: "image-data" as const,
                data: image.data,
                mediaType: image.mediaType,
              },
            ],
          };
        }
        return {
          type: "text" as const,
          value: typeof output === "string" ? output : JSON.stringify(output),
        };
      },
    }),
  };
}

export function boundSkillCatalogPrompt(
  skills: readonly AgentSkillCatalogItem[],
  explicitSkillRevisionId?: string,
): string | undefined {
  const advertised = skills.filter(
    (skill) => skill.bound || skill.skillRevisionId === explicitSkillRevisionId,
  );
  if (advertised.length === 0) return undefined;
  return `<available_skills>\n${advertised
    .map(
      (skill) =>
        `<skill name=${JSON.stringify(skill.skillName)} description=${JSON.stringify(skill.summary)} />`,
    )
    .join("\n")}\n</available_skills>`;
}
