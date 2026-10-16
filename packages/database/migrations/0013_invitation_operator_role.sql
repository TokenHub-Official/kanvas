-- Align invitation roles with Workspace membership roles, including operator.
ALTER TABLE invitation
  DROP CHECK chk_invitation_roles,
  ADD CONSTRAINT chk_invitation_roles CHECK (
    (organization_role IS NULL OR organization_role IN ('owner', 'admin', 'member'))
    AND (workspace_role IS NULL OR workspace_role IN ('owner', 'admin', 'editor', 'operator', 'reviewer', 'viewer'))
    AND (organization_role IS NOT NULL OR workspace_role IS NOT NULL)
    AND (workspace_role IS NULL OR workspace_id IS NOT NULL)
  );
