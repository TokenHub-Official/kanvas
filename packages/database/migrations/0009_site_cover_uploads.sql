ALTER TABLE site_tool_image
  DROP CHECK chk_tool_image_size,
  MODIFY content_bytes mediumblob NULL,
  ADD storage_object json NULL,
  ADD display_name varchar(255) NOT NULL DEFAULT '',
  ADD CONSTRAINT chk_tool_image_content CHECK (
    byte_size BETWEEN 1 AND 524288 AND
    ((storage_object IS NULL AND content_bytes IS NOT NULL AND byte_size = OCTET_LENGTH(content_bytes))
      OR (storage_object IS NOT NULL AND content_bytes IS NULL))
  );

CREATE TABLE site_cover_upload (
  id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id varchar(120) NOT NULL,
  principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_key varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record json NOT NULL,
  lease_token varchar(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until datetime(3) NULL,
  expires_at datetime(3) NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uq_site_cover_operation(instance_id, principal_id, operation_key),
  KEY idx_site_cover_cleanup(state, expires_at, lease_until),
  CONSTRAINT fk_site_cover_instance FOREIGN KEY(instance_id) REFERENCES instance_runtime_state(instance_id),
  CONSTRAINT fk_site_cover_principal FOREIGN KEY(principal_id) REFERENCES principal(id),
  CONSTRAINT chk_site_cover_state CHECK(state IN ('allocated','uploading','verified','committed','cleaning','cleaned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
