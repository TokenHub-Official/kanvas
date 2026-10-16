# ADR-0040: Share working references through Resource Libraries

Status: Accepted; V1 implemented and locally verified.
Date: 2026-10-13

Kanvas needs long-lived product and project references that several Agents can
use without placing business facts inside a Skill or Brand. Introduce a
Workspace-owned Resource Library, independent of Agent identity. Agent bindings
improve discovery; they neither grant access nor force use. Do not introduce a
parallel Agent-owned file repository.

Resource Libraries organize working references and their purpose. Assets retain
their existing role as independently reusable logical content. Library entries
reference exact Artifacts, optionally recording an originating Asset; direct
library uploads do not automatically create Assets. Brands retain structured
creative guidance and Canvas application; Skills retain reusable methods and
method-specific resources. Existing Brand and Skill resources are not migrated.

Saving a library produces an immutable content revision without introducing a
separate publication workflow. Runs pin the library revision they select and
record actual content reads and uses. Current authorization and content
availability are rechecked even for pinned revisions. Resource removal never
implicitly deletes shared bytes or changes a historical revision.

This chooses shared maintenance over Agent-local convenience, and explicit
content identity over dynamically following Asset updates. It adds a resource
organization module, not another storage system or a mandatory retrieval engine.
Image and bounded UTF-8 text consumption precede semantic retrieval.

See the [delivery plan](../plans/shared-resource-libraries-v1.md) for first-release
scope, lifecycle rules, implementation seams, and acceptance evidence.
