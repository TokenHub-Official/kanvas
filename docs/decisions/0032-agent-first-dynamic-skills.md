# ADR-0032: Make Agents the primary product unit and Skills dynamically discoverable

- Status: Accepted
- Date: 2026-09-03
- Supersedes: the Workflow-first product priority in [ADR-0001](0001-ai-creative-operations-platform.md)
- Extends: [ADR-0009](0009-versioned-skill-workflow-packages.md), [ADR-0022](0022-restricted-skill-package-import.md), and [ADR-0030](0030-governed-mastra-agent-runtime.md)

## Context

Kanvas was initially organized as a designer tool platform in which Canvas and
Workflow were primary and one Workspace Agent assisted those surfaces. The runtime
has since proven a governed Agent path through model routing, permissions, budget,
ToolView, Workflow, Artifact, and Canvas handoff. Keeping the tools as the product
subject would make users learn the internal production structure before stating the
outcome they need.

The product now serves two related journeys: designers complete work through Agents,
and designers package stable methods as Skills and Agents for downstream business
operators. This requires many explicit Agents and a Workspace Skill library, while
preserving Kanvas authority over every external effect.

Mastra 1.63 provides dynamic Agent Skills, request-scoped Skill resolution, and
progressive `skill_search`, `skill`, and `skill_read` operations. Reimplementing that
model inside each Kanvas caller would add a second runtime without adding product
authority.

## Decision

1. Agent is the primary product and navigation unit. Canvas, Workflow, Brand, Asset,
   Capability, and Artifact remain independent business objects that Agents discover,
   use, and present.
2. A Workspace owns many stable Agents. One default Agent replaces the previous
   singleton Main Agent entry. One Thread belongs to exactly one Agent; multi-Agent
   rooms and implicit Agent switching are excluded.
3. Agent configuration is published as an immutable Agent Revision. A Thread keeps
   its Agent Revision until the user explicitly upgrades it.
4. An Agent Revision may bind stable Skill, Brand, and Workflow identities. A binding
   supplies default discovery metadata; it is not authorization and does not prevent
   discovery of other accessible published objects.
5. Skill remains separate from Agent, Workflow, Tool, and Capability. Runtime Skill
   Markdown contains SOP guidance and bounded resources for the Agent to interpret,
   never an executable Workflow or executable scripts.
6. Skill runtime content and Skill Presentation are separate. Covers, categories,
   example requests, and example results do not affect the runtime digest.
7. Agent and Thread state remember stable Skill identities. Each Agent Run resolves
   the current published, enabled, and authorized Skill Revision and pins it for that
   Run. A later Run may use a newly published Revision; historical tool results remain
   unchanged.
8. Kanvas constructs one immutable Run Skill View from current Workspace authority,
   visibility, bindings, explicit user selection, activation history, runtime status,
   and resource bounds. Mastra receives that view through an adapter and owns only
   progressive discovery and reading.
9. Bound Skills are advertised without a search call. Other accessible published
   Skills may be found and used for one Run without silently binding them to the
   Agent.
10. Skill discovery does not grant Tool, Workflow, Brand, network, budget, or data
    authority. Every real action continues through the governed ToolView and canonical
    Kanvas command path.
11. Skill packages support a restricted mainstream `SKILL.md` import and export
    profile. Script source can be retained in published packages and viewed or exported
    by people, but is excluded from Agent reference/script reads and never executed. External Skill
    hubs, dependency resolution, SemVer ranges, and automatic remote updates are not
    part of this release.
12. Agent-initiated ordinary production actions follow one Workspace confirmation
    setting, which defaults to streamlined execution without an extra confirmation.
    Destructive, publication, permission, credential, and uncertain-effect actions
    always require explicit confirmation.
13. Visibility initially supports `private` and `workspace`. Team ACLs,
    organization-wide publication, public links, and an external marketplace are
    deferred until a real sharing journey requires them.
14. Thread memory remains Thread-scoped. Agent-wide cross-Thread memory, Agent groups,
    and implicit multi-Agent orchestration are excluded.

## Consequences

- Existing Capability, Workflow, Brand, Artifact, budget, authorization, and recovery
  facts remain authoritative and become the differentiated execution layer behind
  Agents.
- Agent Runs can record which exact Skill Revision was read. They do not claim that
  the final answer causally applied its knowledge, turn reading into a quality score,
  or introduce a separate `use skill` operation.
- Updating a Skill affects the next Run that resolves its stable identity, while one
  active Run remains internally consistent.
- A small Mastra adapter replaces eager instruction concatenation; Server and Worker
  must still agree on the Skill tool contract and ToolView digest.
- The development-only Surface Profiles that never entered the real message path are
  removed instead of migrated.
- The first vertical acceptance is an internal seasonal-poster journey: debug a real
  image result, create and test a Skill from the Thread, reuse it in a new Thread, then
  create an Agent that binds the Skill and Workspace Brand.

## Rejected alternatives

- Keep Canvas or Workflow as the primary product shell and add more copilots.
- Treat Skill binding as an authorization allowlist.
- Copy Brand facts into Skills or infer execution permission from Skill text.
- Build a Kanvas-specific Skill loop instead of adapting the governed Run Skill View
  to Mastra.
- Allow uploaded Skill scripts to run or become readable prompt context.
- Introduce a public registry, vector index, dependency solver, or generalized Team
  ACL before the internal Workspace journey is proven.
