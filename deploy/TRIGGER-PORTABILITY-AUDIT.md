# Trigger portability audit

The archived baseline has 91 triggers across 52 tables. The portable baseline preserves its table definitions, foreign keys, unique keys and CHECK constraints. No trigger is executed on a fresh install. Historical installations retain their existing triggers and applied checksum.

## Authority boundary

Normal application commands preserve immutable facts through insertion of new revisions, idempotency keys, transaction locks and conditional updates. Privileged direct SQL mutation is outside that guarantee. We deliberately retired tests that required raw SQL UPDATE to produce a trigger-specific error; their replacement assertions exercise application conflicts/replays, persisted facts and structural constraints. No application API gains a generic overwrite/delete operation.

## Write-path review and evidence

| Area                                                   | Enforcement and verification                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact identity, lineage and references              | Content commands only adopt ownership or append facts; content-domain integration covers scoped authority, lineage cycles and atomic audit failure. Representation lookup now checks source availability, and cleanup claims expired-source representations under a transaction. New cleanup integration covers immediate withdrawal, competing claimants, retry and preservation of live sources. |
| Audit and budget facts                                 | Audit and ledger writers append; budget transitions use locked accounts, CAS and idempotency keys. Config/secret/budget integration verifies concurrent reservations and retained route snapshots. Authorization integration verifies existing audit facts are retained across subsequent commands.                                                                                                |
| Provider identities and model mappings                 | Settings transitions restrict source states and update named mutable columns. Model mapping rejects published identities; canonical publication rejects revoked models. Provider settings, model control-plane and catalog integration verify replay and publication behavior.                                                                                                                     |
| Provider request snapshots                             | Prepared requests are set only while snapshots are NULL and submission has not started. Submission requires the digest and a valid lease. Provider invocation and Workflow Inbox integration cover persisted input/digest authority.                                                                                                                                                               |
| Resource-source endpoint revocation                    | Found and fixed an actual dependency on the old endpoint trigger: validation could revive a revoked endpoint. The conditional endpoint UPDATE now excludes revoked rows and rejects zero affected rows, rolling back the source update. A real MySQL regression failed before this fix and passed afterward.                                                                                       |
| Secret identity, material and lifecycle                | Secret version commands lock credentials/versions, require eligible lifecycle states, and update through CAS; destruction clears material only from permitted states. Existing secret/budget/route integration verifies pinned old secrets and settlement behavior.                                                                                                                                |
| Contract, adapter, model, pricing and policy revisions | Publication creates new identities/revisions. Runtime update paths deprecate eligible records or change separate bindings/activation records; structural keys retain scope. Catalog installation, model resource publication and control-plane integration run on the trigger-free baseline. Administrative direct SQL remains a trusted operation, not a protected API.                           |
| Drafts, candidates, checks and reviews                 | Draft edits use versions and lifecycle checks. Candidates copy the reviewed document/digest and have no mutation API. Publish/replay rejects mismatched digests or identity. Publication integration now verifies conflicting API calls leave the original revision unchanged.                                                                                                                     |
| Skill imports and revision resources                   | Import transitions use expected version and source-state predicates. CHECK constraints still reject invalid state/link combinations. Skill import/publication and Agent foundation integration cover these paths without triggers.                                                                                                                                                                 |
| Workflow immutable execution facts                     | Switch/output/deadline/approval facts are append-only and use durable identity keys. Orchestrator/Inbox integration covers duplicate delivery, first decision, retained switch facts and corrupt-input rejection.                                                                                                                                                                                  |
| Runtime activation and tombstones                      | Revoke/reactivation decisions are checked in command handlers; versioned activation uses CAS. Removed resources stay represented by lifecycle facts rather than deleting immutable history. Publication and resource lifecycle tests retain those checks.                                                                                                                                          |

The full disposable database suite passed 33 files / 97 tests with binary logging enabled and trust_function_creators OFF; the migration account had only explicit database-scoped DDL/DML privileges, excluding TRIGGER. The later endpoint-revocation regression also passed. This evidence covers implemented command paths, not protection against a database administrator editing records directly.

## Complete historical inventory

Names below refer to the unchanged SQL in packages/database/migrations/legacy/0000_initial_schema.sql. Classification records what the old trigger did; the grouped review above records the application replacement boundary.

| Historical trigger                                  | Table                                    | Event         | Responsibility                    |
| --------------------------------------------------- | ---------------------------------------- | ------------- | --------------------------------- |
| trg_artifact_content_immutable                      | artifact                                 | BEFORE UPDATE | Identity / transition guard       |
| trg_artifact_edge_no_delete                         | artifact_edge                            | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_artifact_edge_no_update                         | artifact_edge                            | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_artifact_reference_no_delete                    | artifact_reference                       | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_artifact_reference_no_update                    | artifact_reference                       | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_artifact_representation_source_expired          | artifact                                 | AFTER UPDATE  | Application cleanup side effect   |
| trg_audit_event_no_delete                           | audit_event                              | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_audit_event_no_update                           | audit_event                              | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_budget_account_no_delete                        | budget_account                           | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_budget_ledger_entry_no_delete                   | budget_ledger_entry                      | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_budget_ledger_entry_no_update                   | budget_ledger_entry                      | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_budget_reservation_no_delete                    | budget_reservation                       | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_canonical_model_identity_immutable              | canonical_model                          | BEFORE UPDATE | Identity / transition guard       |
| trg_canonical_model_no_delete                       | canonical_model                          | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_canvas_draft_reference_no_delete                | canvas_draft_artifact_reference          | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_canvas_draft_reference_no_update                | canvas_draft_artifact_reference          | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_capability_run_update                           | capability_run                           | BEFORE UPDATE | Identity / transition guard       |
| trg_cap_contract_revision_delete                    | capability_contract_revision             | BEFORE DELETE | Identity / transition guard       |
| trg_cap_contract_revision_update                    | capability_contract_revision             | BEFORE UPDATE | Identity / transition guard       |
| trg_cap_declaration_revision_delete                 | capability_declaration_revision          | BEFORE DELETE | Identity / transition guard       |
| trg_cap_declaration_revision_update                 | capability_declaration_revision          | BEFORE UPDATE | Identity / transition guard       |
| trg_cap_impl_revision_delete                        | capability_implementation_revision       | BEFORE DELETE | Identity / transition guard       |
| trg_cap_impl_revision_update                        | capability_implementation_revision       | BEFORE UPDATE | Identity / transition guard       |
| trg_credential_identity_immutable                   | credential                               | BEFORE UPDATE | Identity / transition guard       |
| trg_credential_no_delete                            | credential                               | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_instance_policy_revision_no_delete              | instance_policy_revision                 | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_instance_policy_revision_no_update              | instance_policy_revision                 | BEFORE UPDATE | Identity / transition guard       |
| trg_model_deployment_identity_immutable             | model_deployment                         | BEFORE UPDATE | Identity / transition guard       |
| trg_model_deployment_no_delete                      | model_deployment                         | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_model_profile_revision_no_delete                | model_profile_revision                   | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_model_profile_revision_no_update                | model_profile_revision                   | BEFORE UPDATE | Identity / transition guard       |
| trg_model_reference_snapshot_no_delete              | model_reference_snapshot                 | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_model_reference_snapshot_no_update              | model_reference_snapshot                 | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_model_resource_revision_delete                  | model_resource_revision                  | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_model_resource_revision_update                  | model_resource_revision                  | BEFORE UPDATE | Identity / transition guard       |
| trg_pricing_revision_no_delete                      | pricing_revision                         | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_pricing_revision_no_update                      | pricing_revision                         | BEFORE UPDATE | Identity / transition guard       |
| trg_provider_endpoint_identity_immutable            | provider_endpoint                        | BEFORE UPDATE | Identity / transition guard       |
| trg_provider_endpoint_no_delete                     | provider_endpoint                        | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_provider_invocation_request_snapshots_immutable | provider_invocation                      | BEFORE UPDATE | Identity / transition guard       |
| trg_provider_model_catalog_immutable                | provider_model_catalog_snapshot          | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_provider_model_catalog_no_delete                | provider_model_catalog_snapshot          | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_provider_model_identity_immutable               | provider_model                           | BEFORE UPDATE | Identity / transition guard       |
| trg_provider_model_no_delete                        | provider_model                           | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_provider_setting_identity_immutable             | provider_setting                         | BEFORE UPDATE | Identity / transition guard       |
| trg_provider_setting_no_delete                      | provider_setting                         | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_provider_setting_operation_immutable            | provider_setting_operation               | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_provider_setting_operation_no_delete            | provider_setting_operation               | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_publication_candidate_no_delete                 | publication_candidate                    | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_publication_candidate_no_update                 | publication_candidate                    | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_publication_check_no_delete                     | publication_check                        | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_publication_check_no_update                     | publication_check                        | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_publication_review_no_delete                    | publication_review_decision              | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_publication_review_no_update                    | publication_review_decision              | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_route_policy_revision_no_delete                 | route_policy_revision                    | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_route_policy_revision_no_update                 | route_policy_revision                    | BEFORE UPDATE | Identity / transition guard       |
| trg_runtime_adapter_revision_delete                 | runtime_adapter_revision                 | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_runtime_adapter_revision_update                 | runtime_adapter_revision                 | BEFORE UPDATE | Identity / transition guard       |
| trg_secret_version_material_immutable               | secret_version                           | BEFORE UPDATE | Identity / transition guard       |
| trg_secret_version_no_delete                        | secret_version                           | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_activation_no_delete                      | skill_revision_activation                | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_activation_update                         | skill_revision_activation                | BEFORE UPDATE | Identity / transition guard       |
| trg_skill_draft_no_delete                           | skill_draft                              | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_draft_update                              | skill_draft                              | BEFORE UPDATE | Identity / transition guard       |
| trg_skill_entrypoint_no_delete                      | skill_revision_workflow_entrypoint       | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_entrypoint_no_update                      | skill_revision_workflow_entrypoint       | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_skill_import_no_delete                          | skill_package_import                     | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_import_update                             | skill_package_import                     | BEFORE UPDATE | Identity / transition guard       |
| trg_skill_resource_no_delete                        | skill_revision_resource                  | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_resource_no_update                        | skill_revision_resource                  | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_skill_revision_no_delete                        | skill_revision                           | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_skill_revision_update                           | skill_revision                           | BEFORE UPDATE | Identity / transition guard       |
| trg_workflow_activation_no_delete                   | workflow_revision_activation             | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_workflow_activation_update                      | workflow_revision_activation             | BEFORE UPDATE | Identity / transition guard       |
| trg_workflow_approval_decision_immutable            | workflow_approval_decision               | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_approval_request_immutable             | workflow_approval_request                | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_cap_cancel_immutable                   | workflow_capability_cancellation_request | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_deadline_immutable                     | workflow_deadline_schedule               | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_draft_no_delete                        | workflow_draft                           | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_workflow_draft_update                           | workflow_draft                           | BEFORE UPDATE | Identity / transition guard       |
| trg_workflow_edge_immutable                         | workflow_activated_edge                  | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_map_expansion_immutable                | workflow_map_expansion                   | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_map_item_immutable                     | workflow_map_item                        | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_output_immutable                       | workflow_output_fact                     | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_publication_no_delete                  | workflow_revision_publication            | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_workflow_publication_no_update                  | workflow_revision_publication            | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workflow_revision_no_delete                     | workflow_revision                        | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_workflow_revision_published_immutable           | workflow_revision                        | BEFORE UPDATE | Identity / transition guard       |
| trg_workflow_switch_immutable                       | workflow_switch_decision                 | BEFORE UPDATE | Append-only / lifecycle tombstone |
| trg_workspace_policy_revision_no_delete             | workspace_policy_revision                | BEFORE DELETE | Append-only / lifecycle tombstone |
| trg_workspace_policy_revision_no_update             | workspace_policy_revision                | BEFORE UPDATE | Identity / transition guard       |
