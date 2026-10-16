CREATE TABLE `agent_revision_library_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `library_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`profile_revision_id`,`library_id`),
  UNIQUE KEY `uq_agent_library_ordinal` (`workspace_id`,`profile_revision_id`,`ordinal`),
  CONSTRAINT `fk_agent_library_profile` FOREIGN KEY (`workspace_id`,`profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`,`id`),
  CONSTRAINT `fk_agent_library_owner` FOREIGN KEY (`workspace_id`,`library_id`) REFERENCES `resource_library` (`workspace_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
