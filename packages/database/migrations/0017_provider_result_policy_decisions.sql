CREATE TABLE `provider_result_policy_decision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_invocation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `policy_version` int unsigned NULL,
  `source` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `origin` varchar(300) NOT NULL,
  `outcome` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL,
  INDEX `ix_result_policy_invocation` (`workspace_id`,`provider_invocation_id`,`occurred_at`),
  CONSTRAINT `fk_result_policy_invocation` FOREIGN KEY (`provider_invocation_id`) REFERENCES `provider_invocation` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
