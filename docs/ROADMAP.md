# Roadmap

Kanvas does not yet have a committed public release date. This roadmap highlights
useful contribution areas; it is not a task board, and it does not treat experiments,
mocks, one-off tests, or screenshots as completed product work.

## Before the first public release

- Confirm the public name, trademarks, repository organization, and package names.
- Establish reproducible source builds, container images, migrations, and initial
  administrator setup.
- Publish minimal reproducible demo data and remove references to internal
  environments, domains, credentials, and test assets.
- Establish CI, dependency updates, security reporting, contribution guidance, and
  release notes.

## Core product

- Complete the visible Agent -> Workflow -> Provider -> Artifact -> Canvas loop.
- Deepen Canvas editing, version comparison, human confirmation, and recoverable
  delivery.
- Improve workflow authoring, testing, review, and publication.
- Bring Brand, Asset, and external resource sources into creative context through
  stable versions.

## Operations and ecosystem

- Expand verified provider and model adapters without leaking external protocols
  into Kanvas domain facts.
- Complete real fallback, cancellation, recovery, and cost-settlement evidence for
  browser, worker, and provider execution.
- Improve single-node and distributed storage, backup and restore, and observability
  runbooks.
- Open versioned skill, capability, and resource-source extension points after their
  security boundaries are stable.

Concrete work should be tracked by a public issue and, when applicable, an ADR. A
roadmap item without an issue, acceptance boundary, and maintainer confirmation is
not implementation authorization.
