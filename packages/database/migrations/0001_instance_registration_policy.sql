CREATE TABLE `instance_registration_policy` (
  `instance_id` varchar(120) NOT NULL,
  `mode` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `email_password_enabled` boolean NOT NULL,
  `oidc_provider_ids` json NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`instance_id`),
  KEY `ix_instance_registration_policy_updated_by` (`updated_by_principal_id`),
  CONSTRAINT `fk_instance_registration_policy_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`),
  CONSTRAINT `fk_instance_registration_policy_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `chk_instance_registration_policy_mode` CHECK ((`mode` in (_ascii'closed',_ascii'account_only'))),
  CONSTRAINT `chk_instance_registration_policy_oidc` CHECK ((json_type(`oidc_provider_ids`) = _utf8mb4'ARRAY')),
  CONSTRAINT `chk_instance_registration_policy_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
