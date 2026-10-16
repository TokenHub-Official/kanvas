import { isAbsolute } from "node:path";

const skillKeyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;

export function loadAgentDevelopmentSkillFiles(
  environment: NodeJS.ProcessEnv,
  environmentName: "development" | "test" | "production",
): Readonly<Record<string, string>> | undefined {
  const configured =
    environment.KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON?.trim();
  if (!configured) return undefined;
  if (environmentName !== "development") {
    throw new Error(
      "KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON is development-only.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(configured) as unknown;
  } catch {
    throw new Error(
      "KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON must be valid JSON.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "KANVAS_AGENT_DEVELOPMENT_SKILL_FILES_JSON must be an object.",
    );
  }
  const entries = Object.entries(value);
  if (
    entries.length < 1 ||
    entries.length > 100 ||
    entries.some(
      ([skillKey, path]) =>
        !skillKeyPattern.test(skillKey) ||
        typeof path !== "string" ||
        !isAbsolute(path),
    )
  ) {
    throw new Error(
      "Agent development Skill files require stable Skill keys and absolute paths.",
    );
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}
