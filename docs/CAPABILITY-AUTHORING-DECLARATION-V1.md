# Capability authoring declaration v1

Capability contracts define valid machine input and output. The authoring declaration
projects a pinned contract into searchable catalog metadata, business-oriented fields,
source policies, editors, and semantic output ports for the Workflow authoring UI.

The current declaration is an immutable persisted CapabilityDeclarationRevision. It is
published with a Capability Definition through administration or Catalog installation
and returned by `GET /api/v1/workflow-authoring-capabilities` only when its Definition,
Contract, declared Workflow surface, and Workspace run method are available. The
first-release path has no Application-generated or inferred declaration fallback.

See [CAPABILITIES.md](CAPABILITIES.md) for execution contracts and
[CAPABILITY-SEMANTIC-PORTS-V1.md](CAPABILITY-SEMANTIC-PORTS-V1.md) for compatibility
rules.

## Boundary

A declaration answers:

- which name, description, category, and tags an author sees;
- who may configure a parameter;
- whether a value may be constant, Workflow input, upstream output, rich text, or a
  derived value;
- which host editor represents the field;
- which business semantic an output carries.

It cannot change or relax the pinned contract. Author configuration first compiles
through the declaration and then validates against the contract input schema.

Each API item pins `contractId`, `contractKey`, `revision`, `canonicalDigest`, input and
output schemas, and one declaration with schema version
`kanvas.capability-declaration/v1`. `origin` is always `declared`; the current schema
rejects inferred declarations.

## Revision boundary

Editing localized title, description, category, or tags publishes another Declaration
Revision against the same Contract. It does not rewrite a Workflow draft, published
Workflow Revision, WorkflowRun, or ExecutionPlanSnapshot.

The first release does not provide a general parameter/output-declaration editor after
publication or a public Contract-upgrade path. A future executable Contract change must
coordinate its target Declaration with new pinned Workflow Revisions; it must not
silently reinterpret existing Workflow content.

## Parameter policy

A parameter declaration contains a stable key, localized label and description,
semantic type, required flag, exposure policy, source policy, host editor, optional
default, and optional derivation.

### Exposure

| Value             | Configured by                     | Examples                         |
| ----------------- | --------------------------------- | -------------------------------- |
| `installation`    | Workspace administrator           | Credential or endpoint reference |
| `workflow_author` | Workflow author                   | Fixed quality or Canvas policy   |
| `template_input`  | Person running the published work | User request, reference, count   |
| `hidden_derived`  | Compiler or runtime               | Mask from the same cutout bundle |

Secrets, Workspace IDs, subject IDs, and provider routes are server context, not
ordinary authoring parameters. A declaration may let an author choose whether a field
is fixed by the template or exposed to its runner; the Workflow node stores that
choice.

### Sources

The UI does not add a universal constant-versus-variable switch. It exposes only the
source modes allowed for that parameter:

| Source mode       | Author interaction                                      |
| ----------------- | ------------------------------------------------------- |
| `constant`        | Use the field's business editor                         |
| `workflow_input`  | Select or create a compatible Workflow input            |
| `upstream`        | Select a reachable, semantically compatible output      |
| `mixed_rich_text` | Insert compatible variables into structured rich text   |
| `derived`         | Hide by default and show a read-only source when useful |

For example, an image normally allows `workflow_input` or `upstream`, not a constant
Artifact ID. Quality may allow `constant` or `workflow_input`, presented as a product
choice such as fixed by template or chosen at run time.

### Rich prompts

`@` is an editor trigger and is never persisted. Rich text stores explicit segments:

```json
{
  "kind": "rich_text",
  "segments": [
    { "kind": "text", "text": "Create a poster for: " },
    {
      "kind": "reference",
      "source": "workflow_input",
      "fieldKey": "userPrompt"
    }
  ]
}
```

The authoring compiler emits an explicit `$string` value template. Runtime does not
parse `@...` or `{{...}}` syntax. `$string` may interpolate text, number, boolean, or
null values; objects and arrays require a governed conversion to text.

## Host editors

The v1 contract accepts these host editors:

```text
text
rich_prompt
enum
number
toggle
artifact_picker
artifact_list_picker
canvas_size
placement
background_source
region_list
json
```

An editor changes author interaction, never field schema. Enum options come from the
contract or a narrower declaration projection. The only current composed host profile
is `background_compose`; its implementation remains in the reviewed host registry and
cannot be supplied by declaration text.

## Defaults

Resolution order is:

```text
server context or installation configuration
-> hidden derivation
-> Workflow author policy
-> Workflow input or upstream binding
-> declaration default
-> contract default
```

Each layer may write only parameters allowed by the declaration. Every projected
default must validate against the contract. A draft default remains distinguishable
from an explicit author edit so a later Declaration Revision cannot silently overwrite
the latter.

## Outputs and bundles

An output declaration has a stable key, localized text, semantic type, primary flag,
visibility, and an optional bundle key and role. Persistent Workflow references use
`nodeId + outputKey`; a display name is never identity.

For a background-removal result, foreground and mask share `cutout_result` with
different roles. A `same_bundle_role` derivation can bind the mask after the author
selects its matching foreground, without searching unrelated nodes.

## Catalog and UI

The catalog searches localized title and description, stable contract key, category,
tags, source kind, semantic ports, and current Workspace availability. All business
capabilities use the same generic Capability node. The inspector renders declared
fields and the card shows only the capability name, important input, primary output,
and configuration problems. Contract digests, credentials, Attempts, and JSON
pointers are diagnostic details, not the normal authoring surface.

## Verification

The repository verifies that:

- declared keys exist in the pinned contract and required inputs are covered;
- defaults, enum values, and compiled values pass contract validation;
- rich prompts target strings;
- upstream values are reachable and semantically compatible;
- same-bundle derivation uses one source node and bundle;
- editors and composed UI profiles are from the host registry;
- output declarations do not invent contract results;
- catalog, editor, compiler, and runtime preflight agree for representative poster
  workflows.
