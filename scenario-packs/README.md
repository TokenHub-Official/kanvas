# Scenario packs

This directory contains declarative, versioned scenario content. It is not a pnpm
Workspace and product source code does not import from it.

A pack may contain:

- immutable Capability and Workflow fixtures;
- a restricted Skill manifest and content;
- input and output schemas;
- evaluation criteria and reliability expectations;
- representative media owned or licensed for the repository.

Packs are product examples and regression canaries, not alternate business logic. A
Capability contract, media-safety rule, Artifact commit, authorization rule, or retry
policy belongs in tested application code. A pack cannot relax those boundaries.

`first-party/single-image-cutout-canary` is the disposable MySQL, Worker contract, and
Local Storage input-to-output canary. It pins real canonical digests and never
represents a production background-removal implementation or an installable production
Workspace package.

Poster packs demonstrate published authoring shapes:

- `first-party/poster-generate-simple`: built-in poster instructions plus a user's
  request produce an image;
- `first-party/poster-generate-complete`: an optional reference selects generation or
  editing and `$coalesce` returns one result projection;
- `first-party/poster-compose-subject`: image generation, background removal, and
  background composition.

`pnpm bootstrap:poster-workflows` idempotently installs their editable Drafts,
immutable WorkflowRevisions, and Skill entry points in the local demo Workspace.

`first-party/workflow-authoring-acceptance` is a nonproduction authoring fixture for
parallel joins, switch, approval, and current image Capabilities. Static validation
does not prove a Candidate Run, real image output, or browser journey.

Do not use placeholder digests to imitate a published contract. Invalid and adversarial
pack fixtures live under `tools/scenario-validator/test/fixtures` rather than among
first-party examples.
