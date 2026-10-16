-- A separate revision orders visible Run/message snapshots without invalidating
-- the optimistic version used by user edits and branch selection.
ALTER TABLE agent_thread ADD COLUMN view_revision BIGINT UNSIGNED NOT NULL DEFAULT 1;

ALTER TABLE agent_action_receipt ADD COLUMN query_diagnostics JSON NULL;
