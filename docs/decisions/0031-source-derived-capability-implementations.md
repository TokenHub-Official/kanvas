# ADR-0031: Derive Capability implementations from verified model-source interfaces

- Status: Accepted
- Date: 2026-09-02
- Refines: [ADR-0003](0003-capability-driven-routing.md)

Kanvas creates the simplest Capability from a verified model source rather than asking
an operator to design a public contract before a run method exists. A model resource or
Provider operation declares its native interface; a trusted Runtime Adapter exposes the
normalized invocation interface. Source-first creation copies that invocation interface
into a new Capability Contract and publishes one identity-mapped Implementation and
Binding. Additional Implementations map the same stable Contract to other verified
sources and are ordered by Binding policy. Raw API or tensor interfaces, arbitrary
runtime scripts, and unverified model-name inference do not become public Capability
contracts. This keeps the one-source path nearly automatic while preserving the existing
Contract, Implementation, Binding, and effect-safe fallback architecture.
