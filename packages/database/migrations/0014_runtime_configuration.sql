CREATE TABLE `instance_runtime_configuration_revision` (
  `instance_id` varchar(120) NOT NULL,
  `version` int unsigned NOT NULL,
  `document` json NOT NULL,
  `reason` varchar(500) NOT NULL,
  `published_by` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_at` datetime(3) NOT NULL,
  `restored_from_version` int unsigned NULL,
  PRIMARY KEY (`instance_id`, `version`),
  CONSTRAINT `fk_runtime_configuration_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`),
  CONSTRAINT `fk_runtime_configuration_actor` FOREIGN KEY (`published_by`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `chk_runtime_configuration_document` CHECK (JSON_TYPE(`document`) = 'OBJECT' AND `version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `agent_run` ADD COLUMN `runtime_configuration_version` int unsigned NULL;

CREATE TABLE `runtime_configuration_worker_observation` (
  `instance_id` varchar(120) NOT NULL,
  `worker_id` varchar(120) NOT NULL,
  `deployment` json NOT NULL,
  `configuration_version` int unsigned NULL,
  `observed_at` datetime(3) NOT NULL,
  PRIMARY KEY (`instance_id`, `worker_id`),
  CONSTRAINT `fk_configuration_worker_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
