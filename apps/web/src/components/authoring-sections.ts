const maximumSkillPackageNameLength = 80;
export function agentEditorSection(field: string): string {
  if (field === "instructions") return "instructions";
  if (
    ["skillDefinitionIds", "brandKitIds", "workflowDefinitionIds"].includes(
      field,
    )
  )
    return "resources";
  return "basics";
}
export function skillEditorSection(field: string): string {
  if (field === "instructions") return "instructions";
  if (field === "exampleRequests") return "examples";
  return "basics";
}
export function skillPackageName(
  name: string,
  displayName: string,
  fallback: string,
): string {
  return (
    name.trim() ||
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, maximumSkillPackageNameLength)
      .replace(/-+$/u, "") ||
    `skill-${fallback}`
  );
}
