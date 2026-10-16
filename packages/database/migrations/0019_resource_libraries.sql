CREATE TABLE `resource_library` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` varchar(2000) NOT NULL,
  `lifecycle_status` varchar(16) NOT NULL DEFAULT 'active',
  `version` int unsigned NOT NULL,
  `current_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_library_workspace_id` (`workspace_id`,`id`),
  KEY `ix_library_list` (`workspace_id`,`lifecycle_status`,`id`),
  CONSTRAINT `fk_library_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `fk_library_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_library_editor` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_library_lifecycle` CHECK (`lifecycle_status` IN ('active','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resource_library_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `library_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_number` int unsigned NOT NULL,
  `content_document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_library_revision_scope` (`workspace_id`,`library_id`,`id`),
  UNIQUE KEY `uq_library_revision_number` (`workspace_id`,`library_id`,`revision_number`),
  UNIQUE KEY `uq_library_revision_request` (`workspace_id`,`library_id`,`request_key`),
  CONSTRAINT `fk_library_revision_owner` FOREIGN KEY (`workspace_id`,`library_id`) REFERENCES `resource_library` (`workspace_id`,`id`),
  CONSTRAINT `fk_library_revision_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `resource_library` ADD CONSTRAINT `fk_library_current_revision`
  FOREIGN KEY (`workspace_id`,`id`,`current_revision_id`)
  REFERENCES `resource_library_revision` (`workspace_id`,`library_id`,`id`);

CREATE TABLE `resource_library_entry` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `library_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `name` varchar(240) NOT NULL,
  `purpose` varchar(1000) NOT NULL,
  `position` smallint unsigned NOT NULL,
  PRIMARY KEY (`workspace_id`,`revision_id`,`entry_id`),
  UNIQUE KEY `uq_library_entry_position` (`workspace_id`,`revision_id`,`position`),
  KEY `ix_library_entry_artifact` (`workspace_id`,`artifact_id`),
  CONSTRAINT `fk_library_entry_revision` FOREIGN KEY (`workspace_id`,`library_id`,`revision_id`) REFERENCES `resource_library_revision` (`workspace_id`,`library_id`,`id`),
  CONSTRAINT `fk_library_entry_artifact` FOREIGN KEY (`workspace_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`id`),
  CONSTRAINT `fk_library_entry_asset` FOREIGN KEY (`workspace_id`,`source_asset_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`asset_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Created only by the governed library upload commit, never by generic attachment APIs.
CREATE TABLE `resource_library_upload` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `library_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`library_id`,`artifact_id`),
  CONSTRAINT `fk_library_upload_owner` FOREIGN KEY (`workspace_id`,`library_id`) REFERENCES `resource_library` (`workspace_id`,`id`),
  CONSTRAINT `fk_library_upload_artifact` FOREIGN KEY (`workspace_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`id`),
  CONSTRAINT `fk_library_upload_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
