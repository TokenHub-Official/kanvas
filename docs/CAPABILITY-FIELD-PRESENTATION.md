# Capability field presentation

## Objective

Create usable field names automatically, without asking users to name every
parameter. Capability details and Agent tasks must consume the same declaration.

## Rules

- Preserve saved declarations and explicitly authored labels. Do not bulk rename
  existing capabilities.
- For new adapter-derived declarations, prefer a readable schema title, then a
  known field role/name, then semantic type, then a humanized key. Blank titles
  and raw identifiers are not display names.
- Resolve automatic duplicate labels within inputs and outputs separately using
  field roles or readable keys. Do not collapse distinct outputs into one row.
- Keep the fallback dictionary in one Web module. It is a convenience for missing
  metadata, not a list of supported parameters.
- Direct runs pin their declaration revision. Run details expose input and output
  declarations from that revision. Legacy runs without a pin use the latest
  published declaration at or before creation; missing metadata falls back to
  readable input values. Historical exact identity cannot be reconstructed when
  old publication timestamps are ambiguous.
- Agent detail prefers declared labels and preserves the existing
  filtering of artifact identifiers and unsupported values. Workflow tasks keep
  their effective invocation schema.
- Failure support uses a task reference and the administrator task directory;
  it no longer creates a retry/diagnostic Composer draft. See
  [Task support and administrator records](TASK-SUPPORT-OPERATIONS.md).

## Delivery and verification

Implement automatic naming, declaration pinning and additive run API metadata,
then connect task detail. Verify title precedence, ambiguous names,
unknown parameters, locales, missing metadata, run replay and declaration changes
after a run. Use focused contracts, server, database and Web tests. Check the
affected UI through the existing Chrome session when available.

Existing capabilities keep their saved names. A field-label editing flow and
selective refresh of old automatically generated names are separate follow-up
work; they must distinguish user edits before offering replacements.

## Verification record

- Focused Web, API contract, controller and disposable MySQL suites passed (50
  tests). Coverage includes rendered task labels, both locales, hidden/resource
  inputs, custom titles, duplicate labels, pinned declarations, replay and legacy
  time-based lookup.
- Web, Server, Database and Contracts type checks passed. Changed TypeScript
  files passed ESLint; maintained documentation checks passed.
- Chrome attachment initially timed out. A subsequent retry connected and read
  the existing local tab, which showed `ERR_CONNECTION_REFUSED` on port 5173.
  Browser interaction and visual acceptance remain unverified because the local
  application was unavailable.
- Migration `0005_capability_run_declaration_revision.sql` was tested in an
  isolated database only. Apply it through normal deployment migrations before
  running the updated server; no business database was migrated in this task.
