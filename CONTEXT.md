# Kanvas Domain Language

Kanvas governs reusable creative capabilities independently from the models and
services that implement them.

## Shared working references

**Resource Library**:
A Workspace-maintained collection of working references about a product, project,
or business topic, reusable by multiple Agents and tasks.
_Avoid_: Agent file repository, Brand, Skill, Asset library

**Library Entry**:
One named reference within a Resource Library, with its purpose and the exact
content selected for that collection.
_Avoid_: Asset, file copy, conversation attachment

**Library Revision**:
An immutable saved state of a Resource Library and its entries, identifying the
working references available to a task at a particular point in time.
_Avoid_: latest files, Agent version, published Brand

## Identity and access

**Authentication Account**:
The sign-in identity, credentials, linked providers, and Sessions owned by the
Authentication Engine.
_Avoid_: Principal, Member, Workspace access

**Human Principal**:
The stable Kanvas business identity bound to one Authentication Account. Changes to
email, display name, or linked provider do not create a new Principal.
_Avoid_: Authentication Account, Workspace Member

**Registration Policy**:
The Instance-wide rule that decides whether a new Authentication Account may be
created and by which verified sign-in method.
_Avoid_: Workspace access policy, Membership policy

**Default Workspace Access Policy**:
An Instance Administrator's standing authorization for qualifying self-registered
people to receive an initial Workspace membership. It is distinct from permission
to register and from ongoing membership management.
_Avoid_: Registration Policy, default landing page, automatic role synchronization

**Unassigned Principal**:
An active Human Principal with no active Workspace Membership. It is an authenticated
identity awaiting access, not a personal Workspace or a pending Membership.
_Avoid_: Personal mode, Pending Member, Guest Workspace

**Workspace Membership**:
The explicit lifecycle and role fact that grants one Principal access to one
Workspace.
_Avoid_: Registration, Authentication Account, implicit access

## Model sources

**Model Service**:
A governed connection to a remote Provider whose exact model route and API operation
can execute an inference request.
_Avoid_: Remote capability, Provider capability

**Model Resource**:
An immutable, Workspace-owned model package that a Browser or Worker runtime can load.
_Avoid_: Local capability, model service

**Native Interface**:
The lowest-level inputs and outputs accepted and produced by a model resource or a
Provider API operation.
_Avoid_: Capability contract, public interface

**Invocation Interface**:
The normalized inputs and outputs exposed by a Runtime Adapter after it handles the
source-specific protocol, preprocessing, and postprocessing.
_Avoid_: Native interface, capability contract

## Capabilities

**Capability**:
A stable business operation with a public input and output contract, independent of
the model or service used to execute it.
_Avoid_: Model, Workflow, Agent Skill

**Capability Implementation**:
One immutable mapping from a Capability Contract to one model source through one
Runtime Adapter.
_Avoid_: Capability, Binding, run method

**Capability Binding**:
A Workspace's ordered, governed use of a Capability Implementation, including its
availability and safe fallback policy.
_Avoid_: Capability Implementation, Provider route

## Agents and skills

**Agent**:
A Workspace-owned, reusable work subject that users select and assign work to. An
Agent has a stable identity, published configuration, default context bindings, and
many Threads.
_Avoid_: Thread, page copilot, Agent Template, system prompt

**Built-in Default Agent**:
The single system-managed Agent that receives new Workspace work when no custom
Agent is selected. It remains an Agent for Thread ownership and audit, but is not
user-authored content and cannot be renamed, transferred, hidden, archived, or
reconfigured through ordinary Agent management.
_Avoid_: Custom Agent, background System Agent, default Agent name

**Custom Agent**:
A Workspace-managed Agent created for a specific responsibility from the stable
system Agent template. Its published instructions and resource bindings are
editable without changing the Built-in Default Agent.
_Avoid_: Built-in Default Agent, Agent Template

**Background System Agent**:
An internal bounded execution purpose such as naming or memory observation that is
not a user-visible Agent, owns no Thread, and never appears in the Agent library.
_Avoid_: Built-in Default Agent, Custom Agent

**Agent Revision**:
An immutable published configuration of an Agent, including its instructions and
stable default references to Skills, Brand, and Workflows. A Thread uses one Agent
Revision until the user explicitly upgrades it.
_Avoid_: Agent Run, mutable Agent settings

**Agent Thread**:
The recoverable conversation and work history between a user and exactly one Agent.
_Avoid_: Agent, Agent Run, cross-Agent room

**Agent Run**:
One bounded processing cycle in an Agent Thread. A Run resolves current usable Skill,
Brand, Workflow, ToolView, model, permission, and budget facts and pins their exact
revisions for that cycle.
_Avoid_: Thread, Workflow Run

**Platform Built-in Tool**:
A dialogue capability supplied by Kanvas to every Agent rather than a Workspace
business action.
_Avoid_: Tool Family, Capability, Skill

**Agent Interaction**:
A point in an Agent Run where the Agent needs a person's structured input before it
can decide how to continue. It carries information, not authorization.
_Avoid_: ActionReceipt, approval, action confirmation

**ActionReceipt**:
A durable account of one business action proposed or executed by an Agent, including
whether it required approval and what outcome it produced.
_Avoid_: Agent Interaction, Tool Call, task

**Skill**:
A discoverable, distributable work method that guides an Agent through Instructions
and bounded supporting resources. A Skill may refer to governed Workflows but never
grants authority or becomes an execution state machine.
_Avoid_: Capability, Tool, Workflow, Agent, executable script

**Skill Revision**:
An immutable published version of a Skill's runtime content. Agent and Thread
preferences refer to the stable Skill identity; each Agent Run pins the exact usable
Skill Revision it read.
_Avoid_: Skill Draft, Skill Presentation

**Skill Presentation**:
Mutable discovery information such as title, summary, cover, category, tags, author,
example requests, and example results. It does not alter Skill runtime behavior or
the Skill Revision digest.
_Avoid_: Skill Instructions, Skill Revision

**Bound Skill**:
A Skill whose discovery metadata is supplied by default to an Agent. Binding improves
discovery but does not grant permission or prevent the Agent from finding other
accessible published Skills.
_Avoid_: activated Skill, Skill authorization

**Skill Use**:
The fact that one Agent Run read a specific Skill Revision, whether it was bound,
explicitly selected, or discovered during the Run.
_Avoid_: Skill installation, quality evaluation

**Agent responsibility**:
The user-facing job and behavior of an Agent. Human access remains a Member Role and
must not also be called an Agent role in domain contracts.
_Avoid_: Workspace Role, permission role

## Brands

**Brand**:
A Workspace-owned creative identity whose published content constrains and guides
future work without rewriting existing work.
_Avoid_: Asset folder, mutable style settings

**Brand Reference Image**:
A pinned visual example that communicates the intended look, composition, lighting,
or material treatment of a Brand. It guides people and Agents but is not a Logo or a
Canvas node.
_Avoid_: Logo, generated result, dynamic Asset pointer

**Brand Maintenance**:
Creating or changing a Brand Draft and publishing an explicit version. An Agent may
perform maintenance only through the same Workspace authority and review boundary as
a person.
_Avoid_: Prompt-only brand changes, silently updating published work

## Site-managed tools

**Site Tool**:
A site-owned interactive utility uploaded and maintained exclusively by site administrators,
with a stable identity, discoverable presentation, and explicitly governed use.
_Avoid_: Capability, Platform Built-in Tool, Skill, fixed first-party tool

**Tool Revision**:
An immutable published version of a Site Tool's executable content and approved
integration requirements. Updating a Tool does not rewrite its prior Revisions.
_Avoid_: mutable HTML, Tool identity, Capability Implementation

**Tool Presentation**:
Editable discovery information such as name, optional instructions, Logo and cover. The consumer grid shows only Logo/cover and name.
Presentation changes do not change the executable content of a published Revision.
_Avoid_: Tool Revision, executable configuration, permission grant

**Tool Usage Session**:
One person's bounded use of an exact Tool Revision within one Workspace. It does not
own or replace the independent lifecycle of tasks and results created during use.
_Avoid_: Authentication Session, CapabilityRun, tool installation

## Content and assets

**Artifact**:
An immutable Workspace content fact with provenance, classification, and availability. An Artifact may be referenced by a Thread or another business object without being discoverable in the Asset library.
_Avoid_: Asset, attachment, mutable file

**Thread Attachment**:
An Artifact referenced as private working context by one Agent Thread. It remains outside the Asset library until the Thread owner explicitly saves it as an Asset.
_Avoid_: Workspace Asset, personal Asset, uploaded Asset

**Asset**:
A Workspace-visible, user-managed logical identity for reusable content whose current Artifact was explicitly adopted. Being uploaded or generated in an Agent Thread does not by itself create an Asset.
_Avoid_: Artifact, Thread Attachment, every generated result
