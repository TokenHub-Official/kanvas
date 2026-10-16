-- Keep revision/session references intact while removing deleted tools from discovery.
-- Deletion is permitted only for disabled tools by the application transaction.
ALTER TABLE site_tool
  ADD COLUMN deleted_at datetime(3) NULL,
  ADD INDEX idx_site_tool_visible (instance_id, deleted_at, updated_at);
