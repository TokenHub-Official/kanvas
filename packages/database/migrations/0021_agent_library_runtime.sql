CREATE TABLE `agent_run_library` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `library_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` varchar(16) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`run_id`,`library_id`),
  UNIQUE KEY `uq_run_library_revision` (`workspace_id`,`run_id`,`revision_id`),
  CONSTRAINT `fk_run_library_run` FOREIGN KEY (`workspace_id`,`run_id`) REFERENCES `agent_run` (`workspace_id`,`id`),
  CONSTRAINT `fk_run_library_revision` FOREIGN KEY (`workspace_id`,`library_id`,`revision_id`) REFERENCES `resource_library_revision` (`workspace_id`,`library_id`,`id`),
  CONSTRAINT `chk_run_library_source` CHECK (`source` IN ('explicit','discovered'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_run_library_use` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `use_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `use_kind` varchar(24) NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`run_id`,`use_key`),
  KEY `ix_library_use_artifact` (`workspace_id`,`artifact_id`),
  CONSTRAINT `fk_library_use_pin` FOREIGN KEY (`workspace_id`,`run_id`,`revision_id`) REFERENCES `agent_run_library` (`workspace_id`,`run_id`,`revision_id`),
  CONSTRAINT `fk_library_use_entry` FOREIGN KEY (`workspace_id`,`revision_id`,`entry_id`) REFERENCES `resource_library_entry` (`workspace_id`,`revision_id`,`entry_id`),
  CONSTRAINT `fk_library_use_artifact` FOREIGN KEY (`workspace_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`id`),
  CONSTRAINT `chk_library_use_kind` CHECK (`use_kind` IN ('text_read','image_view','tool_input'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
