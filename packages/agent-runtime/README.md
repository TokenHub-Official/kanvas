# Kanvas Agent Runtime

This package is the only workspace package allowed to depend directly on
Mastra. It adapts Mastra agent primitives to Kanvas-owned runtime boundaries.

## Responsibilities

- Project the current authorized ToolView into Mastra tools.
- Adapt the governed `KanvasAgentModelPort` to the Mastra model interface.
- Coordinate action receipts around Tool execution.
- Run the surface Agent with pinned Skill and context inputs.
- Produce bounded observational thread memory without creating another source
  of business truth.

Mastra owns the in-process model loop and stream protocol. Kanvas owns Workspace
authorization, model and Provider routing, Secret resolution, budget and Usage,
Agent/Workflow/Capability records, Artifact state, canonical validation and
Audit.

Product code must not call a Provider SDK or Mastra Model Router directly. The
Worker composes the governed route resolver, budget port and secret-scoped
transport before a remote call is allowed.

See
[`docs/AGENT-PRODUCT-AND-RUNTIME-V1.md`](../../docs/AGENT-PRODUCT-AND-RUNTIME-V1.md)
for the complete boundary.
