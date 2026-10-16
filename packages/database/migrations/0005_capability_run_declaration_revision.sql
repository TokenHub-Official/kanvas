-- Presentation identity is pinned independently of execution routing.
-- NULL keeps legacy and Workflow-created runs compatible.
ALTER TABLE capability_run
  ADD COLUMN declaration_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT fk_cap_run_declaration
    FOREIGN KEY (workspace_id, declaration_revision_id)
    REFERENCES capability_declaration_revision (workspace_id, id);
