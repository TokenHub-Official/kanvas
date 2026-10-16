type SkillVisibility = {
  readonly id: string;
  readonly visibility: "private" | "workspace";
};

type BoundSkillAvailability = {
  readonly id: string;
  readonly workspaceAvailability:
    | "available"
    | "private"
    | "disabled"
    | "deleted"
    | "revoked"
    | "unavailable";
};

export function privateSkillIdsForWorkspaceAgent(
  selectedSkillDefinitionIds: readonly string[],
  visibleSkills: readonly SkillVisibility[],
  boundSkills: readonly BoundSkillAvailability[],
): readonly string[] {
  const visibleById = new Map(visibleSkills.map((skill) => [skill.id, skill]));
  const boundById = new Map(boundSkills.map((skill) => [skill.id, skill]));
  return [
    ...new Set(
      selectedSkillDefinitionIds.filter((id) => {
        const visible = visibleById.get(id);
        if (visible) return visible.visibility === "private";
        return boundById.get(id)?.workspaceAvailability === "private";
      }),
    ),
  ];
}
