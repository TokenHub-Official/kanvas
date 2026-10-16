CREATE TABLE `resource_library_text` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `extractor_version` varchar(80) NOT NULL,
  `text_content` mediumtext NOT NULL,
  `page_ranges` json NOT NULL,
  `extraction_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`artifact_id`),
  FULLTEXT KEY `ix_library_text_content` (`text_content`) WITH PARSER ngram,
  CONSTRAINT `fk_library_text_artifact` FOREIGN KEY (`workspace_id`,`artifact_id`) REFERENCES `artifact` (`workspace_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `agent_run_library_use` ADD COLUMN `locations` json DEFAULT NULL;
