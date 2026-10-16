CREATE TABLE `instance_default_access_policy` (
  `instance_id` varchar(120) NOT NULL PRIMARY KEY,
  `policy` json NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  CONSTRAINT `fk_default_access_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`),
  CONSTRAINT `fk_default_access_administrator` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `chk_default_access_policy` CHECK (JSON_TYPE(`policy`) = 'OBJECT' AND `version` >= 1 AND JSON_EXTRACT(`policy`, '$.version') = `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `default_access_enrollment` (
  `auth_subject_id` varchar(240) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `instance_id` varchar(120) NOT NULL,
  `source` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `policy_snapshot` json NOT NULL,
  `state` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`instance_id`, `auth_subject_id`),
  INDEX `ix_default_access_state` (`instance_id`, `state`),
  CONSTRAINT `fk_default_access_enrollment_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`),
  CONSTRAINT `chk_default_access_enrollment` CHECK (`source` IN ('self','invitation','managed') AND `state` IN ('pending','granted','excluded','failed') AND `reason` IN ('awaiting_verification','workspace_unavailable','temporary_failure','assigned','not_eligible') AND JSON_TYPE(`policy_snapshot`) = 'OBJECT' AND `updated_at` >= `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
