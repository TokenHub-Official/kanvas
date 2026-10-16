ALTER TABLE site_tool
  ADD visual_symbol json NULL,
  ADD CONSTRAINT chk_tool_visual_identity CHECK (visual_symbol IS NULL OR logo_image_id IS NULL);
