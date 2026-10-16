# Product definition and scope

## Background

Visual design teams repeat production work across tools with little reuse. Individual
AI providers can perform isolated generation or editing steps, but generic chat and
tool surfaces do not turn a designer's stable method into a reusable teammate for the
designer or downstream business users.

Kanvas supports governed native providers and OpenAI-compatible gateways, while its
product architecture, protocols, and license remain independent of any one channel.

## Users

### Confirmed users

- The primary users are professional or advanced visual designers working in teams.
- Downstream marketing and business operators use Agents that designers have prepared
  from stable responsibilities, Skills, Brand context, and governed capabilities.
- Kanvas supports production work, not general consumer entertainment.
- Browser, operating-system, and hardware support can be expressed as an explicit
  compatibility matrix.
- Users understand professional concepts such as layers, selections, masks, versions,
  reference images, and model cost.

### Potential future users

- Self-hosted design and content-production teams.
- Open-source contributors building provider, capability, and workflow extensions.

## Position

> Kanvas is a governed Agent Hub for creative and content-production teams.

Agent is the primary unit of work. Designers use Agents directly and package stable
methods as Skills and published Agents that downstream operators can reuse. Canvas and
Workflow remain optional work surfaces and execution objects behind that journey.

The primary product loop is:

```text
Find or create an Agent
-> state a goal and attach available context
-> Agent discovers bound or accessible Skills, Brand, and Workflows
-> governed Tools create real Runs and Artifacts
-> inspect results in the conversation and resource workbench
-> optionally continue in Canvas or stabilize a repeated process as Workflow
-> turn a proven method into a reusable Skill or Agent
```

Reference products include LobeHub for Agent-as-work-unit and progressive Skill
discovery, Canva Enterprise for team and brand governance, Adobe GenStudio for content
supply chains and review, and Lovart for brief-driven visual production. They are
interaction and capability references, not cloning targets.

## Requirement layers

Raw requests must be classified before they become product navigation.

### Business workflows

Outcomes that users need to deliver, such as:

- commerce campaign image sets;
- event and social media image sets;
- basic batch image production;
- product or portrait retouching;
- brand material production.

### Agent products

Workspace-owned Agents combine a user-facing summary with core instructions and bound
discovery metadata for Skills, Brand, and Workflows. These bindings make relevant
objects immediately visible to the Agent; they neither require their use nor limit the
Agent to them. One Agent owns many Threads; one Thread belongs to exactly one Agent. A
Skill is independently discoverable and usable without being permanently bound to an
Agent.

### Platform capabilities

Shared capabilities used by multiple business workflows, including:

- Workspace and any future task context justified by real workflows;
- StoredObject, Artifact, Asset, and Lineage;
- execution and result relationships among the current Canvas, Workflow Run, and
  Asset;
- WorkflowRun, NodeRun, CapabilityRun, and CapabilityAttempt;
- Brand Preset and Template;
- Usage Ledger, history, and search;
- comments, approval, audit, quotas, and permissions.

### Atomic capabilities

Stable semantics that a workflow can orchestrate and whose implementation can be
replaced, such as:

- background removal;
- subject segmentation;
- image generation or editing;
- OCR;
- upscaling;
- resizing;
- copy generation;
- template rendering.

### Implementations

Concrete execution methods for an atomic capability, such as:

- a browser WebGPU model;
- a browser WASM tool;
- an internal GPU worker;
- the OpenAI API;
- OpenRouter;
- a model channel behind TokenHub or NewAPI.

## Initial validation loops

The first Agent-first validation loop is an internal seasonal-poster journey: complete
one real branded image task in a Thread, create and Candidate-test a Skill from that
Thread, reuse the published Skill in a new Thread, then publish an Agent that binds the
Skill and Brand for a downstream operator. The system proves discovery, instructions,
authorization, execution, cost, and Artifact facts; visual quality remains a user and
model outcome rather than an automatic Agent score.

Additional first-party loops support internal discovery, golden examples, product
validation, and prioritization. They remain versioned Workflow and Skill content, not
hard-coded platform modules. Reusable media, security, Artifact, execution, and
governance behavior remains tested code.

A Workflow is an independently executable definition. A Skill's Markdown Instructions
can describe a human-readable SOP that teaches the Agent how to approach work and when
to call available tools or Workflows. That SOP is guidance interpreted by the Agent;
it is not a Workflow definition and never participates in the Workflow execution state
machine. A Skill may reference Workflows alongside References, Templates, Assets, or
evaluation resources without merging the two concepts. Workflow and Skill drafts are
mutable; review submission creates an immutable PublicationCandidate; published
revisions are immutable. Validation, testing, and review are publication-gate records,
not lifecycle states.

The product does not currently expose Project, Brief, ProjectDeliverable, or a
standalone Work Session. Earlier pages and local acceptance data were removed because
they did not form a real creation, collaboration, and recovery journey. The visible
objects are Canvas, Asset, and Run: Canvas holds creative work, Asset holds reusable
results, and Run holds execution state and diagnostics.

Only redefine a task or production order after real work consistently contains
multiple explicit outputs, unified acceptance, and deadline constraints. Model any
new object from user actions, permissions, and its state machine; do not revive the
development-era Project model. Public Project and Deliverable Work Session HTTP
contracts and their internal modules, permissions, fields, and tables have been
removed. [ADR-0035](decisions/0035-retire-project-deliverable-and-converge-internal-formats.md)
records the current boundary. Earlier ADRs retain the model as superseded evidence;
it is not a compatibility contract and must not return to Web navigation or product
copy.

Content uses three layers: StoredObject is the physical object, Artifact is immutable
business content, and Asset is a user-managed logical asset with a currently adopted
Artifact. Machine intermediates do not have to become Assets.

First-party scenario packs live behind the separate `scenario-packs/` monorepo
boundary. They are product examples and regression canaries for Capability, Workflow,
Artifact, reliability, and Agent ToolView behavior. The two durable scenario families
below define the broader product boundaries.

### Scenario A: basic batch commerce-image processing

```text
Batch source images
-> Browser or Worker background removal
-> manual correction of low-quality masks
-> composition against a fixed background and one OutputProfile
-> partial-success summary
-> ZIP and manifest
-> delivery
```

Scenario A is the first deterministic production-pipeline canary.

### Scenario B: commerce campaign hero image

```text
Confirmed campaign requirements
-> generate a small candidate set
-> human selection
-> fixed-template rendering
-> manual adjustment and final approval
-> delivery
```

Scenario B covers nondeterministic creative decisions. Automated marketing strategy,
free-form layout, automatic brand scoring, automatic selection, and unbounded Agent
self-correction are outside the current boundary.

See [ADR-0011](decisions/0011-scenario-boundaries-and-first-party-canaries.md) and
[ADR-0013](decisions/0013-v0-canary-batch-execution.md) for the durable scenario
decisions.

## Out of scope

- A complete online Photoshop replacement.
- A professional video editor.
- A complete Office or PowerPoint replacement.
- A general consumer AI-tool collection.
- A first-party foundation model.
- Unbounded Agent autonomy or removal of confirmation for destructive, publication,
  permission, credential, or uncertain-effect operations.
- Mastra Workflow, Storage, or Model Router; unbounded persistent memory; or
  multi-Agent orchestration.
- Cross-Thread Agent memory, external Skill hubs, executable Skill scripts, a Skill
  dependency solver, or a public plugin marketplace in the first release.
- Complete automated logo, intellectual-property, or visual-identity design in the
  first release.

## Success metrics

The MVP should be measured against real work, not feature count. Candidate targets
are:

- at least a 50% reduction in core-workflow production time;
- 70% weekly active use in the target design team;
- 50% first-draft usability;
- replacement of 40% to 50% of comparable external AI-tool calls;
- 30% reuse of assets across similar work;
- traceable model, parameters, duration, and cost for every adopted final asset;
- fallback from failed browser-local capabilities without blocking core delivery.

These values require baselines from real work before they become commitments.

## Naming

Kanvas is an internal codename. Before public release, re-evaluate:

- name and positioning semantics;
- trademark similarity;
- domains and search results;
- GitHub organization, npm, and container-image names.

The public name should avoid confusion with Canva, Canvas, and existing products
named Kanvas.
