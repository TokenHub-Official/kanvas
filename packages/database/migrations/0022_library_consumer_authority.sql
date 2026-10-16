CREATE TABLE `resource_library_consumer_input` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consumer_kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consumer_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_snapshot` json NOT NULL,
  `authority_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requires_asset_read` boolean NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`consumer_kind`,`consumer_id`,`artifact_id`),
  CONSTRAINT `fk_library_consumer_artifact` FOREIGN KEY (`workspace_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`id`),
  CONSTRAINT `chk_library_consumer_kind` CHECK (`consumer_kind` IN ('capability','workflow'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
