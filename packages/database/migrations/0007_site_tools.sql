CREATE TABLE site_tool_image (
  id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id varchar(120) NOT NULL,
  content_bytes mediumblob NOT NULL,
  content_sha256 char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_size int unsigned NOT NULL,
  width int unsigned NOT NULL,
  height int unsigned NOT NULL,
  created_by_principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tool_image_scope (instance_id, id),
  CONSTRAINT fk_tool_image_instance FOREIGN KEY (instance_id) REFERENCES instance_runtime_state (instance_id),
  CONSTRAINT fk_tool_image_creator FOREIGN KEY (created_by_principal_id) REFERENCES principal (id),
  CONSTRAINT chk_tool_image_size CHECK (byte_size BETWEEN 1 AND 524288 AND byte_size = OCTET_LENGTH(content_bytes)),
  CONSTRAINT chk_tool_image_dimensions CHECK (width BETWEEN 1 AND 2048 AND height BETWEEN 1 AND 2048)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE site_tool (
  id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id varchar(120) NOT NULL,
  slug varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name varchar(160) NOT NULL,
  summary varchar(600) NOT NULL,
  description_markdown text NOT NULL,
  logo_image_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  cover_image_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  category varchar(80) NOT NULL DEFAULT '',
  tags json NOT NULL,
  created_by_principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usage_status varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'enabled',
  current_draft_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  published_revision_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  execution_epoch int unsigned NOT NULL DEFAULT 1,
  version int unsigned NOT NULL DEFAULT 1,
  created_at datetime(3) NOT NULL,
  updated_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_site_tool_scope (instance_id, id),
  UNIQUE KEY uq_site_tool_slug (instance_id, slug),
  CONSTRAINT fk_site_tool_instance FOREIGN KEY (instance_id) REFERENCES instance_runtime_state (instance_id),
  CONSTRAINT fk_site_tool_creator FOREIGN KEY (created_by_principal_id) REFERENCES principal (id),
  CONSTRAINT fk_site_tool_logo_image FOREIGN KEY (instance_id, logo_image_id) REFERENCES site_tool_image (instance_id, id),
  CONSTRAINT fk_site_tool_cover_image FOREIGN KEY (instance_id, cover_image_id) REFERENCES site_tool_image (instance_id, id),
  CONSTRAINT chk_site_tool_usage CHECK (usage_status IN ('enabled', 'disabled')),
  CONSTRAINT chk_site_tool_version CHECK (version >= 1 AND execution_epoch >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE site_tool_revision (
  id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id varchar(120) NOT NULL,
  tool_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_number int unsigned DEFAULT NULL,
  version_label varchar(80) NOT NULL DEFAULT '',
  release_notes text NOT NULL,
  source_filename varchar(160) NOT NULL,
  source_bytes mediumblob NOT NULL,
  source_sha256 char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_size int unsigned NOT NULL,
  allowed_contract_revision_ids json NOT NULL,
  revision_digest char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_status varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unchecked',
  check_policy_version varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  check_result json DEFAULT NULL,
  lifecycle_status varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
  created_by_principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_by_principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  created_at datetime(3) NOT NULL,
  published_at datetime(3) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tool_revision_scope (instance_id, tool_id, id),
  UNIQUE KEY uq_tool_revision_number (instance_id, tool_id, revision_number),
  CONSTRAINT fk_tool_revision_tool FOREIGN KEY (instance_id, tool_id) REFERENCES site_tool (instance_id, id),
  CONSTRAINT fk_tool_revision_creator FOREIGN KEY (created_by_principal_id) REFERENCES principal (id),
  CONSTRAINT fk_tool_revision_publisher FOREIGN KEY (published_by_principal_id) REFERENCES principal (id),
  CONSTRAINT chk_tool_revision_size CHECK (byte_size BETWEEN 1 AND 2097152 AND byte_size = OCTET_LENGTH(source_bytes)),
  CONSTRAINT chk_tool_revision_check CHECK (check_status IN ('unchecked', 'passed', 'failed')),
  CONSTRAINT chk_tool_revision_lifecycle CHECK (lifecycle_status IN ('draft', 'published')),
  CONSTRAINT chk_tool_revision_publication CHECK (
    (lifecycle_status = 'draft' AND published_at IS NULL AND published_by_principal_id IS NULL AND revision_number IS NULL)
    OR (lifecycle_status = 'published' AND published_at IS NOT NULL AND published_by_principal_id IS NOT NULL AND revision_number IS NOT NULL AND revision_number >= 1 AND check_status = 'passed')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE site_tool
  ADD CONSTRAINT fk_tool_current_draft FOREIGN KEY (instance_id, id, current_draft_id) REFERENCES site_tool_revision (instance_id, tool_id, id),
  ADD CONSTRAINT fk_tool_current_publication FOREIGN KEY (instance_id, id, published_revision_id) REFERENCES site_tool_revision (instance_id, tool_id, id);

CREATE TABLE site_tool_session (
  id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  instance_id varchar(120) NOT NULL,
  workspace_id char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  tool_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_digest char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authentication_ref_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_epoch int unsigned NOT NULL,
  session_kind varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  maximum_runs int unsigned NOT NULL,
  policy_version varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'kanvas.html-tool/self-contained-v1',
  allowed_contract_revision_ids json NOT NULL DEFAULT (JSON_ARRAY()),
  created_at datetime(3) NOT NULL,
  expires_at datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tool_session_scope (workspace_id, id),
  KEY ix_tool_session_tool (workspace_id, tool_id, principal_id, created_at),
  CONSTRAINT fk_tool_session_revision FOREIGN KEY (instance_id, tool_id, revision_id) REFERENCES site_tool_revision (instance_id, tool_id, id),
  CONSTRAINT fk_tool_session_principal FOREIGN KEY (principal_id) REFERENCES principal (id),
  CONSTRAINT fk_tool_session_workspace FOREIGN KEY (workspace_id) REFERENCES workspace (id),
  CONSTRAINT chk_tool_session_kind CHECK ((session_kind = 'preview' AND maximum_runs = 0) OR (session_kind = 'use' AND workspace_id IS NOT NULL)),
  CONSTRAINT chk_tool_session_state CHECK (state IN ('active', 'closed')),
  CONSTRAINT chk_tool_session_limits CHECK (maximum_runs BETWEEN 0 AND 10 AND expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE site_tool_session_run (
  workspace_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  capability_run_id char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (workspace_id, session_id, request_key),
  UNIQUE KEY uq_tool_session_run (workspace_id, capability_run_id),
  CONSTRAINT fk_tool_session_run_session FOREIGN KEY (workspace_id, session_id) REFERENCES site_tool_session (workspace_id, id),
  CONSTRAINT fk_tool_session_run_capability FOREIGN KEY (workspace_id, capability_run_id) REFERENCES capability_run (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE site_tool_operation (
  instance_id varchar(120) NOT NULL,
  idempotency_key varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result json NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (instance_id, idempotency_key),
  CONSTRAINT fk_tool_operation_instance FOREIGN KEY (instance_id) REFERENCES instance_runtime_state (instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
