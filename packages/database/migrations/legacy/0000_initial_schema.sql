-- Kanvas current data-free schema baseline.

-- Application data and migration history are intentionally excluded.

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;

SET @OLD_TIME_ZONE=@@TIME_ZONE;

SET TIME_ZONE='+00:00';

SET NAMES utf8mb4;

CREATE TABLE `agent_action_receipt` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action_number` smallint unsigned NOT NULL,
  `tool_call_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tool_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `effect` varchar(24) NOT NULL,
  `approval_mode` varchar(24) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `output_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `proposal_document` json DEFAULT NULL,
  `outcome_kind` varchar(32) DEFAULT NULL,
  `query_result_count` int unsigned DEFAULT NULL,
  `canvas_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workflow_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `skill_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `brand_kit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `brand_kit_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `before_version` int unsigned DEFAULT NULL,
  `after_version` int unsigned DEFAULT NULL,
  `undo_group_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_action_number` (`agent_run_id`,`action_number`),
  UNIQUE KEY `uq_agent_action_tool_call` (`agent_run_id`,`tool_call_id`),
  KEY `fk_agent_action_run` (`workspace_id`,`agent_run_id`),
  KEY `fk_agent_action_canvas` (`workspace_id`,`canvas_draft_id`),
  KEY `fk_agent_action_capability` (`workspace_id`,`capability_run_id`),
  KEY `fk_agent_action_workflow_run` (`workspace_id`,`workflow_run_id`),
  KEY `fk_agent_action_workflow_definition` (`workspace_id`,`workflow_definition_id`),
  KEY `ix_agent_action_status` (`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_agent_action_brand_revision` (`workspace_id`,`brand_kit_id`,`brand_kit_revision_id`),
  CONSTRAINT `fk_agent_action_brand_revision` FOREIGN KEY (`workspace_id`, `brand_kit_id`, `brand_kit_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `brand_kit_id`, `id`),
  CONSTRAINT `fk_agent_action_canvas` FOREIGN KEY (`workspace_id`, `canvas_draft_id`) REFERENCES `canvas_draft` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_action_capability` FOREIGN KEY (`workspace_id`, `capability_run_id`) REFERENCES `capability_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_action_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_action_workflow_definition` FOREIGN KEY (`workspace_id`, `workflow_definition_id`) REFERENCES `workflow_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_action_workflow_run` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_action_approval` CHECK (((`approval_mode` in (_utf8mb4'none',_utf8mb4'before_call',_utf8mb4'before_commit')) and ((`effect` not in (_utf8mb4'external_write',_utf8mb4'destructive')) or (`approval_mode` <> _utf8mb4'none')))),
  CONSTRAINT `chk_agent_action_effect` CHECK ((`effect` in (_utf8mb4'read',_utf8mb4'compute',_utf8mb4'internal_write',_utf8mb4'external_write',_utf8mb4'destructive'))),
  CONSTRAINT `chk_agent_action_number` CHECK ((`action_number` >= 1)),
  CONSTRAINT `chk_agent_action_outcome` CHECK ((((`outcome_kind` is null) and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null)) or ((`outcome_kind` = _utf8mb4'query') and (`query_result_count` is not null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null)) or ((`outcome_kind` = _utf8mb4'canvas_command') and (`query_result_count` is null) and (`canvas_draft_id` is not null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null) and (`before_version` is not null) and (`after_version` is not null)) or ((`outcome_kind` = _utf8mb4'capability_run') and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is not null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null)) or ((`outcome_kind` = _utf8mb4'workflow_run') and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is not null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null)) or ((`outcome_kind` = _utf8mb4'workflow_draft_command') and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is not null) and (`skill_draft_id` is null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null) and (`before_version` is not null) and (`after_version` is not null)) or ((`outcome_kind` = _utf8mb4'skill_draft') and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is not null) and (`brand_kit_id` is null) and (`brand_kit_revision_id` is null)) or ((`outcome_kind` = _utf8mb4'brand_revision') and (`query_result_count` is null) and (`canvas_draft_id` is null) and (`capability_run_id` is null) and (`workflow_run_id` is null) and (`workflow_definition_id` is null) and (`skill_draft_id` is null) and (`brand_kit_id` is not null) and (`brand_kit_revision_id` is not null)))),
  CONSTRAINT `chk_agent_action_proposal_document` CHECK (((`proposal_document` is null) or (json_type(`proposal_document`) = _utf8mb4'OBJECT'))),
  CONSTRAINT `chk_agent_action_status` CHECK ((`lifecycle_status` in (_utf8mb4'proposed',_utf8mb4'waiting_approval',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_agent_action_terminal` CHECK ((((`lifecycle_status` = _utf8mb4'succeeded') and (`output_digest` is not null) and (`terminal_reason_code` is null) and (`completed_at` is not null)) or ((`lifecycle_status` in (_utf8mb4'failed',_utf8mb4'cancelled')) and (`terminal_reason_code` is not null) and (`completed_at` is not null)) or ((`lifecycle_status` = _utf8mb4'proposed') and (`output_digest` is null) and (`proposal_document` is null) and (`outcome_kind` is null) and (`terminal_reason_code` is null) and (`completed_at` is null)) or ((`lifecycle_status` in (_utf8mb4'waiting_approval',_utf8mb4'running')) and (`outcome_kind` is null) and (`terminal_reason_code` is null) and (`completed_at` is null) and (((`output_digest` is null) and (`proposal_document` is null)) or ((`output_digest` is not null) and (`proposal_document` is not null)))))),
  CONSTRAINT `chk_agent_action_version` CHECK ((`version` >= 1)),
  CONSTRAINT `chk_agent_action_versions` CHECK ((((`before_version` is null) and (`after_version` is null)) or ((`before_version` is not null) and (`after_version` is not null) and (`after_version` > `before_version`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_definition` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `management_kind` varchar(16) NOT NULL DEFAULT 'workspace',
  `system_key` varchar(80) DEFAULT NULL,
  `owner_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `visibility` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  `usage_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'enabled',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_definition_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_definition_key` (`workspace_id`,`agent_key`),
  UNIQUE KEY `uq_agent_definition_creation_request` (`workspace_id`,`creation_request_key`),
  UNIQUE KEY `uq_agent_definition_system_key` (`workspace_id`,`system_key`),
  KEY `ix_agent_definition_discover` (`workspace_id`,`visibility`,`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_agent_definition_owner` (`workspace_id`,`owner_principal_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_agent_definition_owner` (`owner_principal_id`),
  KEY `fk_agent_definition_creator` (`created_by_principal_id`),
  KEY `fk_agent_definition_updater` (`updated_by_principal_id`),
  CONSTRAINT `fk_agent_definition_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_definition_owner` FOREIGN KEY (`owner_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_definition_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_definition_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_agent_definition_archive` CHECK ((((`lifecycle_status` = _ascii'active') and (`archived_at` is null)) or ((`lifecycle_status` = _ascii'archived') and (`archived_at` is not null)))),
  CONSTRAINT `chk_agent_definition_digest` CHECK (regexp_like(`creation_request_hash`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_agent_definition_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived'))),
  CONSTRAINT `chk_agent_definition_management` CHECK ((((`management_kind` = _utf8mb4'system') and (`system_key` is not null)) or ((`management_kind` = _utf8mb4'workspace') and (`system_key` is null)))),
  CONSTRAINT `chk_agent_definition_system_lifecycle` CHECK (((`management_kind` <> _utf8mb4'system') or ((`visibility` = _ascii'workspace') and (`lifecycle_status` = _ascii'active') and (`archived_at` is null)))),
  CONSTRAINT `chk_agent_definition_usage` CHECK ((`usage_status` in (_utf8mb4'enabled',_utf8mb4'disabled'))),
  CONSTRAINT `chk_agent_definition_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_agent_definition_visibility` CHECK ((`visibility` in (_ascii'private',_ascii'workspace')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_interaction` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `assistant_message_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `interaction_number` smallint unsigned NOT NULL,
  `tool_call_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `tool_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_document` json NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `response_document` json DEFAULT NULL,
  `response_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `checkpoint_document` json NOT NULL,
  `checkpoint_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resolution_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `resolved_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_interaction_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_interaction_number` (`agent_run_id`,`interaction_number`),
  UNIQUE KEY `uq_agent_interaction_tool_call` (`agent_run_id`,`tool_call_id`),
  KEY `ix_agent_interaction_status` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_agent_interaction_message` (`workspace_id`,`assistant_message_id`,`id`),
  KEY `ix_agent_interaction_resolver` (`resolved_by_principal_id`),
  KEY `fk_agent_interaction_run` (`workspace_id`,`agent_run_id`),
  KEY `fk_agent_interaction_message` (`assistant_message_id`),
  CONSTRAINT `fk_agent_interaction_message` FOREIGN KEY (`assistant_message_id`) REFERENCES `agent_message` (`id`),
  CONSTRAINT `fk_agent_interaction_resolver` FOREIGN KEY (`resolved_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_interaction_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_interaction_number` CHECK ((`interaction_number` between 1 and 16)),
  CONSTRAINT `chk_agent_interaction_resolution` CHECK ((((`lifecycle_status` = _utf8mb4'pending') and (`response_document` is null) and (`response_digest` is null) and (`resolution_request_key` is null) and (`resolved_by_principal_id` is null) and (`completed_at` is null)) or ((`lifecycle_status` in (_utf8mb4'submitted',_utf8mb4'skipped',_utf8mb4'cancelled')) and (`response_document` is not null) and (`response_digest` is not null) and (`resolution_request_key` is not null) and (`resolved_by_principal_id` is not null) and (`completed_at` is not null)))),
  CONSTRAINT `chk_agent_interaction_status` CHECK ((`lifecycle_status` in (_utf8mb4'pending',_utf8mb4'submitted',_utf8mb4'skipped',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_agent_interaction_tool` CHECK ((`tool_key` = _utf8mb4'builtin.ask-question')),
  CONSTRAINT `chk_agent_interaction_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_message` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `thread_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `parent_message_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `sequence_number` int unsigned NOT NULL,
  `alternative_index` int unsigned NOT NULL DEFAULT '1',
  `role` varchar(16) NOT NULL,
  `content` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_message_sequence` (`thread_id`,`sequence_number`),
  KEY `ix_agent_message_run` (`workspace_id`,`agent_run_id`,`sequence_number`),
  KEY `fk_agent_message_parent` (`parent_message_id`),
  KEY `ix_agent_message_parent` (`workspace_id`,`thread_id`,`parent_message_id`,`alternative_index`),
  CONSTRAINT `fk_agent_message_parent` FOREIGN KEY (`parent_message_id`) REFERENCES `agent_message` (`id`),
  CONSTRAINT `fk_agent_message_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_message_thread` FOREIGN KEY (`workspace_id`, `thread_id`) REFERENCES `agent_thread` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_message_alternative_index` CHECK ((`alternative_index` >= 1)),
  CONSTRAINT `chk_agent_message_role` CHECK ((`role` in (_utf8mb4'user',_utf8mb4'assistant'))),
  CONSTRAINT `chk_agent_message_sequence` CHECK ((`sequence_number` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_model_attempt` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_model_call_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_number` smallint unsigned NOT NULL,
  `transition_kind` varchar(16) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `route_snapshot` json NOT NULL,
  `route_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_request_id` varchar(512) DEFAULT NULL,
  `accepted_marker` tinyint(1) DEFAULT NULL,
  `usage_document` json DEFAULT NULL,
  `usage_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `started_at` datetime(3) DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_model_attempt_number` (`agent_model_call_id`,`attempt_number`),
  UNIQUE KEY `uq_agent_model_attempt_accepted` (`agent_model_call_id`,`accepted_marker`),
  KEY `fk_agent_model_attempt_call` (`workspace_id`,`agent_model_call_id`),
  KEY `ix_agent_model_attempt_status` (`lifecycle_status`,`created_at`,`id`),
  CONSTRAINT `fk_agent_model_attempt_call` FOREIGN KEY (`workspace_id`, `agent_model_call_id`) REFERENCES `agent_model_call` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_model_attempt_accepted` CHECK (((`accepted_marker` is null) or ((`accepted_marker` = true) and (`lifecycle_status` = _utf8mb4'succeeded')))),
  CONSTRAINT `chk_agent_model_attempt_number` CHECK ((`attempt_number` >= 1)),
  CONSTRAINT `chk_agent_model_attempt_status` CHECK ((`lifecycle_status` in (_utf8mb4'prepared',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled',_utf8mb4'unknown'))),
  CONSTRAINT `chk_agent_model_attempt_timestamps` CHECK ((((`lifecycle_status` = _utf8mb4'prepared') and (`started_at` is null) and (`completed_at` is null)) or ((`lifecycle_status` = _utf8mb4'running') and (`started_at` is not null) and (`completed_at` is null)) or ((`lifecycle_status` in (_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled',_utf8mb4'unknown')) and (`started_at` is not null) and (`completed_at` is not null)))),
  CONSTRAINT `chk_agent_model_attempt_transition` CHECK ((`transition_kind` in (_utf8mb4'initial',_utf8mb4'retry',_utf8mb4'fallback'))),
  CONSTRAINT `chk_agent_model_attempt_usage` CHECK ((((`usage_document` is null) and (`usage_digest` is null)) or ((`usage_document` is not null) and (`usage_digest` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_model_binding` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `binding_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_deployment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `budget_account_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `maximum_charge_currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `maximum_charge_amount` decimal(36,12) NOT NULL,
  `pricing_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `api_surface` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `protocol_kind` varchar(32) NOT NULL DEFAULT 'openai_chat',
  `lifecycle_status` varchar(16) NOT NULL,
  `route_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_model_binding_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_model_binding_key` (`workspace_id`,`binding_key`),
  UNIQUE KEY `uq_agent_model_binding_idempotency` (`workspace_id`,`idempotency_key`),
  KEY `fk_agent_model_binding_profile` (`workspace_id`,`model_profile_revision_id`),
  KEY `fk_agent_model_binding_deployment` (`workspace_id`,`model_deployment_id`),
  KEY `fk_agent_model_binding_endpoint` (`workspace_id`,`provider_endpoint_id`),
  KEY `fk_agent_model_binding_credential` (`workspace_id`,`credential_id`),
  KEY `fk_agent_model_binding_pricing` (`workspace_id`,`pricing_revision_id`),
  KEY `fk_agent_model_binding_budget` (`workspace_id`,`budget_account_id`),
  KEY `fk_agent_model_binding_created_by` (`created_by_principal_id`),
  KEY `fk_agent_model_binding_updated_by` (`updated_by_principal_id`),
  KEY `ix_agent_model_binding_status` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_agent_model_binding_budget` FOREIGN KEY (`workspace_id`, `budget_account_id`) REFERENCES `budget_account` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_model_binding_credential` FOREIGN KEY (`workspace_id`, `credential_id`) REFERENCES `credential` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_deployment` FOREIGN KEY (`workspace_id`, `model_deployment_id`) REFERENCES `model_deployment` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_pricing` FOREIGN KEY (`workspace_id`, `pricing_revision_id`) REFERENCES `pricing_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_profile` FOREIGN KEY (`workspace_id`, `model_profile_revision_id`) REFERENCES `model_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_model_binding_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_model_binding_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_agent_model_binding_disabled` CHECK ((((`lifecycle_status` = _utf8mb4'enabled') and (`disabled_at` is null)) or ((`lifecycle_status` = _utf8mb4'disabled') and (`disabled_at` is not null)))),
  CONSTRAINT `chk_agent_model_binding_maximum_charge` CHECK ((regexp_like(`maximum_charge_currency_code`,_ascii'^[A-Z]{3}$') and (`maximum_charge_amount` >= 0))),
  CONSTRAINT `chk_agent_model_binding_protocol` CHECK ((`protocol_kind` in (_utf8mb4'openai_chat',_utf8mb4'deepseek_chat',_utf8mb4'openai_responses',_utf8mb4'gemini_generate_content',_utf8mb4'anthropic_messages'))),
  CONSTRAINT `chk_agent_model_binding_status` CHECK ((`lifecycle_status` in (_utf8mb4'enabled',_utf8mb4'disabled'))),
  CONSTRAINT `chk_agent_model_binding_surface` CHECK ((`api_surface` in (_ascii'chat.completions.v1',_ascii'responses.v1',_ascii'generate-content.v1',_ascii'messages.v1'))),
  CONSTRAINT `chk_agent_model_binding_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_model_call` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `call_number` smallint unsigned NOT NULL,
  `purpose` varchar(32) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `model_profile_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `output_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `finish_reason` varchar(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_model_call_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_model_call_number` (`agent_run_id`,`call_number`),
  KEY `fk_agent_model_call_run` (`workspace_id`,`agent_run_id`),
  KEY `ix_agent_model_call_status` (`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_agent_model_call_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_model_call_number` CHECK ((`call_number` >= 1)),
  CONSTRAINT `chk_agent_model_call_purpose` CHECK ((`purpose` in (_utf8mb4'plan',_utf8mb4'tool_selection',_utf8mb4'final_response',_utf8mb4'structured_output',_utf8mb4'web_search',_utf8mb4'memory_observation',_utf8mb4'thread_title'))),
  CONSTRAINT `chk_agent_model_call_status` CHECK ((`lifecycle_status` in (_utf8mb4'pending',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_agent_model_call_terminal` CHECK ((((`lifecycle_status` = _utf8mb4'succeeded') and (`output_digest` is not null) and (`finish_reason` is not null) and (`terminal_reason_code` is null) and (`completed_at` is not null)) or ((`lifecycle_status` in (_utf8mb4'failed',_utf8mb4'cancelled')) and (`terminal_reason_code` is not null) and (`completed_at` is not null)) or ((`lifecycle_status` in (_utf8mb4'pending',_utf8mb4'running')) and (`output_digest` is null) and (`finish_reason` is null) and (`terminal_reason_code` is null) and (`completed_at` is null)))),
  CONSTRAINT `chk_agent_model_call_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_presentation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` varchar(160) NOT NULL,
  `summary` varchar(600) NOT NULL,
  `avatar` json DEFAULT NULL,
  `cover_asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `tags` json NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`agent_definition_id`),
  KEY `fk_agent_presentation_cover_asset` (`workspace_id`,`cover_asset_id`),
  KEY `fk_agent_presentation_updater` (`updated_by_principal_id`),
  CONSTRAINT `fk_agent_presentation_cover_asset` FOREIGN KEY (`workspace_id`, `cover_asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_presentation_definition` FOREIGN KEY (`workspace_id`, `agent_definition_id`) REFERENCES `agent_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_presentation_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_agent_presentation_tags` CHECK ((json_type(`tags`) = _utf8mb4'ARRAY')),
  CONSTRAINT `chk_agent_presentation_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_profile_activation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_status` varchar(16) NOT NULL,
  `reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`profile_revision_id`),
  KEY `fk_agent_profile_activation_revision` (`workspace_id`,`profile_revision_id`),
  KEY `fk_agent_profile_activation_updated_by` (`updated_by_principal_id`),
  KEY `ix_agent_profile_activation_status` (`workspace_id`,`runtime_status`,`updated_at`,`profile_revision_id`),
  CONSTRAINT `fk_agent_profile_activation_revision` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_profile_activation_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_agent_profile_activation_status` CHECK ((`runtime_status` in (_utf8mb4'enabled',_utf8mb4'disabled',_utf8mb4'revoked'))),
  CONSTRAINT `chk_agent_profile_activation_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_profile_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(16) NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `manifest_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_profile_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_profile_revision_number` (`workspace_id`,`profile_key`,`revision`),
  KEY `fk_agent_profile_revision_created_by` (`created_by_principal_id`),
  KEY `fk_agent_profile_revision_published_by` (`published_by_principal_id`),
  KEY `fk_agent_profile_revision_definition` (`workspace_id`,`agent_definition_id`),
  KEY `ix_agent_profile_revision_digest` (`workspace_id`,`canonical_digest`),
  CONSTRAINT `fk_agent_profile_revision_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_profile_revision_definition` FOREIGN KEY (`workspace_id`, `agent_definition_id`) REFERENCES `agent_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_profile_revision_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_profile_revision_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_agent_profile_revision_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'published',_utf8mb4'deprecated'))),
  CONSTRAINT `chk_agent_profile_revision_number` CHECK ((`revision` >= 1)),
  CONSTRAINT `chk_agent_profile_revision_schema` CHECK ((`schema_version` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_revision_brand_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_kit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`profile_revision_id`,`brand_kit_id`),
  UNIQUE KEY `uq_agent_revision_brand_ordinal` (`profile_revision_id`,`ordinal`),
  KEY `fk_agent_revision_brand_kit` (`workspace_id`,`brand_kit_id`),
  CONSTRAINT `fk_agent_revision_brand_kit` FOREIGN KEY (`workspace_id`, `brand_kit_id`) REFERENCES `brand_kit` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_revision_brand_profile` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_revision_skill_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`profile_revision_id`,`skill_definition_id`),
  UNIQUE KEY `uq_agent_revision_skill_ordinal` (`profile_revision_id`,`ordinal`),
  KEY `fk_agent_revision_skill_definition` (`workspace_id`,`skill_definition_id`),
  CONSTRAINT `fk_agent_revision_skill_definition` FOREIGN KEY (`workspace_id`, `skill_definition_id`) REFERENCES `skill_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_revision_skill_profile` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_revision_workflow_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`profile_revision_id`,`workflow_definition_id`),
  UNIQUE KEY `uq_agent_revision_workflow_ordinal` (`profile_revision_id`,`ordinal`),
  KEY `fk_agent_revision_workflow_definition` (`workspace_id`,`workflow_definition_id`),
  CONSTRAINT `fk_agent_revision_workflow_definition` FOREIGN KEY (`workspace_id`, `workflow_definition_id`) REFERENCES `workflow_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_revision_workflow_profile` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_run` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `thread_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `trigger_message_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `context_snapshot` json NOT NULL,
  `context_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tool_view_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prompt_revision` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `maximum_model_calls` smallint unsigned NOT NULL,
  `maximum_tool_calls` smallint unsigned NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `execution_deadline_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_run_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_run_idempotency` (`workspace_id`,`idempotency_key`),
  KEY `fk_agent_run_actor` (`actor_principal_id`),
  KEY `ix_agent_run_thread_recent` (`workspace_id`,`thread_id`,`created_at`,`id`),
  KEY `ix_agent_run_active` (`lifecycle_status`,`execution_deadline_at`,`updated_at`,`id`),
  KEY `fk_agent_run_parent` (`parent_run_id`),
  KEY `ix_agent_run_parent` (`workspace_id`,`parent_run_id`,`created_at`,`id`),
  KEY `fk_agent_run_trigger_message` (`trigger_message_id`),
  CONSTRAINT `fk_agent_run_actor` FOREIGN KEY (`actor_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_run_parent` FOREIGN KEY (`parent_run_id`) REFERENCES `agent_run` (`id`),
  CONSTRAINT `fk_agent_run_thread` FOREIGN KEY (`workspace_id`, `thread_id`) REFERENCES `agent_thread` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_run_trigger_message` FOREIGN KEY (`trigger_message_id`) REFERENCES `agent_message` (`id`),
  CONSTRAINT `chk_agent_run_deadline` CHECK ((`execution_deadline_at` > `created_at`)),
  CONSTRAINT `chk_agent_run_limits` CHECK (((`maximum_model_calls` between 1 and 64) and (`maximum_tool_calls` <= 128))),
  CONSTRAINT `chk_agent_run_status` CHECK ((`lifecycle_status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'waiting_approval',_utf8mb4'waiting_for_user',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_agent_run_terminal` CHECK ((((`lifecycle_status` in (_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled')) and (`completed_at` is not null)) or ((`lifecycle_status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'waiting_approval',_utf8mb4'waiting_for_user')) and (`completed_at` is null) and (`terminal_reason_code` is null)))),
  CONSTRAINT `chk_agent_run_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_run_dispatch` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `delivery_status` varchar(16) NOT NULL,
  `available_at` datetime(3) NOT NULL,
  `claim_owner` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `claim_token_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_expires_at` datetime(3) DEFAULT NULL,
  `delivery_count` int unsigned NOT NULL,
  `last_error_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`agent_run_id`),
  KEY `fk_agent_run_dispatch_run` (`workspace_id`,`agent_run_id`),
  KEY `ix_agent_run_dispatch_claim` (`delivery_status`,`available_at`,`lease_expires_at`,`agent_run_id`),
  KEY `ix_agent_run_dispatch_worker` (`claim_owner`,`delivery_status`,`lease_expires_at`,`agent_run_id`),
  CONSTRAINT `fk_agent_run_dispatch_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_run_dispatch_claim_state` CHECK ((((`delivery_status` = _utf8mb4'queued') and (`claim_owner` is null) and (`claim_token_digest` is null) and (`lease_expires_at` is null) and (`completed_at` is null)) or ((`delivery_status` = _utf8mb4'claimed') and (`claim_owner` is not null) and (`claim_token_digest` is not null) and (`lease_expires_at` is not null) and (`completed_at` is null)) or ((`delivery_status` in (_utf8mb4'completed',_utf8mb4'quarantined')) and (`claim_owner` is null) and (`claim_token_digest` is null) and (`lease_expires_at` is null) and (`completed_at` is not null)))),
  CONSTRAINT `chk_agent_run_dispatch_status` CHECK ((`delivery_status` in (_utf8mb4'queued',_utf8mb4'claimed',_utf8mb4'completed',_utf8mb4'quarantined'))),
  CONSTRAINT `chk_agent_run_dispatch_version` CHECK (((`version` >= 1) and (`delivery_count` >= 0) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_run_foundation_context` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_view_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_context_snapshot` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`agent_run_id`),
  KEY `fk_agent_run_foundation_run` (`workspace_id`,`agent_run_id`),
  KEY `ix_agent_run_foundation_profile` (`workspace_id`,`profile_revision_id`,`agent_run_id`),
  CONSTRAINT `fk_agent_run_foundation_profile` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_run_foundation_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_run_foundation_snapshot` CHECK ((json_type(`skill_context_snapshot`) = _utf8mb4'ARRAY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_run_skill_use` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `first_used_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`agent_run_id`,`skill_revision_id`),
  KEY `fk_agent_run_skill_use_revision` (`workspace_id`,`skill_revision_id`),
  KEY `ix_agent_run_skill_use_revision` (`workspace_id`,`skill_revision_id`,`first_used_at`,`agent_run_id`),
  CONSTRAINT `fk_agent_run_skill_use_revision` FOREIGN KEY (`workspace_id`, `skill_revision_id`) REFERENCES `skill_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_run_skill_use_run` FOREIGN KEY (`workspace_id`, `agent_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_run_skill_use_digest` CHECK (regexp_like(`canonical_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_agent_run_skill_use_source` CHECK ((`source` in (_utf8mb4'bound',_utf8mb4'explicit',_utf8mb4'discovered')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_surface_profile_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `surface_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`surface_kind`),
  KEY `fk_agent_surface_profile_updated_by` (`updated_by_principal_id`),
  KEY `ix_agent_surface_profile_revision` (`workspace_id`,`profile_revision_id`,`surface_kind`),
  CONSTRAINT `fk_agent_surface_profile_revision` FOREIGN KEY (`workspace_id`, `profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_surface_profile_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_agent_surface_profile_kind` CHECK ((`surface_kind` in (_ascii'agent_workspace',_ascii'workspace_home',_ascii'canvas',_ascii'asset',_ascii'workflow_run',_ascii'workflow_authoring',_ascii'brand'))),
  CONSTRAINT `chk_agent_surface_profile_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_thread` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agent_profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) NOT NULL,
  `title` varchar(240) DEFAULT NULL,
  `title_source` varchar(16) NOT NULL DEFAULT 'auto',
  `active_leaf_message_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `creation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  `active_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_thread_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_agent_thread_creation_request` (`workspace_id`,`creation_request_key`),
  KEY `fk_agent_thread_created_by` (`created_by_principal_id`),
  KEY `ix_agent_thread_recent` (`workspace_id`,`created_by_principal_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_agent_thread_active_leaf` (`active_leaf_message_id`),
  KEY `fk_agent_thread_definition` (`workspace_id`,`agent_definition_id`),
  KEY `fk_agent_thread_profile_revision` (`workspace_id`,`agent_profile_revision_id`),
  KEY `ix_agent_thread_active_run` (`workspace_id`,`active_run_id`),
  CONSTRAINT `fk_agent_thread_active_leaf` FOREIGN KEY (`active_leaf_message_id`) REFERENCES `agent_message` (`id`),
  CONSTRAINT `fk_agent_thread_active_run` FOREIGN KEY (`workspace_id`, `active_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_thread_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_agent_thread_definition` FOREIGN KEY (`workspace_id`, `agent_definition_id`) REFERENCES `agent_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_thread_profile_revision` FOREIGN KEY (`workspace_id`, `agent_profile_revision_id`) REFERENCES `agent_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_agent_thread_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_agent_thread_archive` CHECK ((((`lifecycle_status` = _utf8mb4'active') and (`archived_at` is null)) or ((`lifecycle_status` = _utf8mb4'archived') and (`archived_at` is not null)))),
  CONSTRAINT `chk_agent_thread_status` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'archived'))),
  CONSTRAINT `chk_agent_thread_title_source` CHECK ((`title_source` in (_utf8mb4'auto',_utf8mb4'manual'))),
  CONSTRAINT `chk_agent_thread_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_thread_memory` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `thread_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `active_observations` mediumtext NOT NULL,
  `observations_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `last_observed_at` datetime(3) NOT NULL,
  `observer_model_binding_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`thread_id`),
  CONSTRAINT `fk_agent_thread_memory_thread` FOREIGN KEY (`workspace_id`, `thread_id`) REFERENCES `agent_thread` (`workspace_id`, `id`),
  CONSTRAINT `chk_agent_thread_memory_digest` CHECK (regexp_like(`observations_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_agent_thread_memory_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `art_text_preset_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_id` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `manifest_document` json NOT NULL,
  `manifest_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provenance_document` json NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_art_text_preset_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_art_text_preset_manifest` (`workspace_id`,`source_id`,`external_id`,`manifest_digest`),
  UNIQUE KEY `uq_art_text_preset_idempotency` (`workspace_id`,`idempotency_key`),
  KEY `fk_art_text_preset_source_revision` (`workspace_id`,`source_id`,`source_revision_id`),
  KEY `fk_art_text_preset_created_by` (`created_by_principal_id`),
  KEY `ix_art_text_preset_catalog` (`workspace_id`,`created_at`,`id`),
  CONSTRAINT `fk_art_text_preset_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_art_text_preset_source_revision` FOREIGN KEY (`workspace_id`, `source_id`, `source_revision_id`) REFERENCES `resource_source_revision` (`workspace_id`, `source_id`, `id`),
  CONSTRAINT `chk_art_text_preset_identity` CHECK (((`schema_version` = 1) and regexp_like(`manifest_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `structured_content` json DEFAULT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_type` varchar(120) NOT NULL,
  `availability_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'available',
  `data_classification` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'internal',
  `display_filename` varchar(255) DEFAULT NULL,
  `metadata` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_artifact_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_artifact_workspace_asset_id` (`workspace_id`,`asset_id`,`id`),
  KEY `fk_artifact_stored` (`stored_object_id`),
  KEY `ix_artifact_workspace` (`workspace_id`,`created_at`),
  KEY `ix_artifact_availability` (`workspace_id`,`availability_status`,`data_classification`,`created_at`,`id`),
  KEY `fk_artifact_stored_scope` (`workspace_id`,`stored_object_id`),
  KEY `ix_artifact_asset` (`workspace_id`,`asset_id`,`availability_status`,`created_at`,`id`),
  KEY `ix_artifact_capability_run` (`workspace_id`,`created_by_capability_run_id`,`created_at`,`id`),
  KEY `fk_artifact_created_by` (`created_by_principal_id`),
  CONSTRAINT `fk_artifact_asset` FOREIGN KEY (`workspace_id`, `asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_capability_run` FOREIGN KEY (`workspace_id`, `created_by_capability_run_id`) REFERENCES `capability_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_artifact_stored_scope` FOREIGN KEY (`workspace_id`, `stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_artifact_availability` CHECK ((`availability_status` in (_ascii'staging',_ascii'quarantined',_ascii'available',_ascii'rejected',_ascii'expired'))),
  CONSTRAINT `chk_artifact_classification` CHECK ((`data_classification` in (_ascii'internal',_ascii'confidential',_ascii'restricted'))),
  CONSTRAINT `chk_artifact_content` CHECK ((((`stored_object_id` is not null) and (`structured_content` is null)) or ((`stored_object_id` is null) and (`structured_content` is not null)))),
  CONSTRAINT `chk_artifact_content_digest` CHECK (regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_artifact_display_filename` CHECK (((`display_filename` is null) or (char_length(`display_filename`) between 1 and 255))),
  CONSTRAINT `chk_artifact_producer` CHECK (((`created_by_capability_run_id` is null) or (`created_by_principal_id` is null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact_edge` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_artifact_edge_identity` (`source_artifact_id`,`target_artifact_id`,`relation`),
  KEY `fk_artifact_edge_created_by` (`created_by_principal_id`),
  KEY `ix_artifact_edge_target` (`workspace_id`,`target_artifact_id`,`relation`,`source_artifact_id`),
  KEY `ix_artifact_edge_source` (`workspace_id`,`source_artifact_id`,`relation`,`target_artifact_id`),
  CONSTRAINT `fk_artifact_edge_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_artifact_edge_source` FOREIGN KEY (`workspace_id`, `source_artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_edge_target` FOREIGN KEY (`workspace_id`, `target_artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `chk_artifact_edge_not_self` CHECK ((`source_artifact_id` <> `target_artifact_id`)),
  CONSTRAINT `chk_artifact_edge_relation` CHECK ((`relation` in (_ascii'derived_from',_ascii'supersedes',_ascii'composed_from',_ascii'generated_from')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact_reference` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference_role` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_artifact_reference_identity` (`workspace_id`,`artifact_id`,`reference_role`,`target_type`,`target_id`),
  KEY `fk_artifact_reference_asset` (`workspace_id`,`asset_id`),
  KEY `fk_artifact_reference_created_by` (`created_by_principal_id`),
  KEY `ix_artifact_reference_workflow` (`workspace_id`,`workflow_run_id`,`reference_role`,`artifact_id`),
  CONSTRAINT `fk_artifact_reference_artifact` FOREIGN KEY (`workspace_id`, `artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_reference_asset` FOREIGN KEY (`workspace_id`, `asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `fk_artifact_reference_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_artifact_reference_workflow` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_artifact_reference_role` CHECK ((char_length(`reference_role`) between 1 and 80)),
  CONSTRAINT `chk_artifact_reference_target` CHECK ((((`target_type` = _utf8mb4'workflow_run') and (`target_id` = `workflow_run_id`) and (`workflow_run_id` is not null) and (`asset_id` is null)) or ((`target_type` = _utf8mb4'asset') and (`target_id` = `asset_id`) and (`workflow_run_id` is null) and (`asset_id` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact_representation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `variant_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_version` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_profile_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `container` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `object_key` varchar(800) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `immutable_identity_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `byte_size` bigint unsigned NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `media_type` varchar(160) NOT NULL,
  `width` int unsigned NOT NULL,
  `height` int unsigned NOT NULL,
  `state` varchar(24) NOT NULL,
  `cleanup_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cleanup_lease_expires_at` datetime(3) DEFAULT NULL,
  `cleanup_attempts` int unsigned NOT NULL DEFAULT '0',
  `cleanup_retry_at` datetime(3) DEFAULT NULL,
  `cleanup_error_code` varchar(120) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_artifact_representation_variant` (`workspace_id`,`source_artifact_id`,`variant_key`,`profile_version`),
  UNIQUE KEY `uq_artifact_representation_object` (`storage_profile_id`,`container`,`object_key`),
  KEY `ix_artifact_representation_cleanup` (`state`,`cleanup_retry_at`,`cleanup_lease_expires_at`,`id`),
  CONSTRAINT `fk_artifact_representation_source` FOREIGN KEY (`workspace_id`, `source_artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `chk_artifact_representation_cleanup` CHECK ((((`state` = _utf8mb4'available') and (`cleanup_token_hash` is null) and (`cleanup_lease_expires_at` is null) and (`deleted_at` is null)) or ((`state` = _utf8mb4'deletion_pending') and (`deleted_at` is null)) or ((`state` in (_utf8mb4'deleted',_utf8mb4'missing')) and (`deleted_at` is not null)))),
  CONSTRAINT `chk_artifact_representation_digest` CHECK ((regexp_like(`immutable_identity_hash`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`sha256`,_ascii'^[0-9a-f]{64}$'))),
  CONSTRAINT `chk_artifact_representation_dimensions` CHECK (((`width` >= 1) and (`height` >= 1))),
  CONSTRAINT `chk_artifact_representation_media` CHECK ((`media_type` = _utf8mb4'image/webp')),
  CONSTRAINT `chk_artifact_representation_state` CHECK ((`state` in (_utf8mb4'available',_utf8mb4'deletion_pending',_utf8mb4'deleted',_utf8mb4'missing')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asset_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(240) NOT NULL,
  `asset_type` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `current_artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_workspace_key` (`workspace_id`,`asset_key`),
  UNIQUE KEY `uq_asset_workspace_id` (`workspace_id`,`id`),
  KEY `fk_asset_created_by` (`created_by_principal_id`),
  KEY `fk_asset_current_artifact` (`workspace_id`,`id`,`current_artifact_id`),
  KEY `ix_asset_workspace_lifecycle` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_asset_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_asset_current_artifact` FOREIGN KEY (`workspace_id`, `id`, `current_artifact_id`) REFERENCES `artifact` (`workspace_id`, `asset_id`, `id`),
  CONSTRAINT `fk_asset_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_asset_key` CHECK ((char_length(`asset_key`) between 1 and 160)),
  CONSTRAINT `chk_asset_name` CHECK ((char_length(`name`) between 1 and 240)),
  CONSTRAINT `chk_asset_status` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived'))),
  CONSTRAINT `chk_asset_type` CHECK ((char_length(`asset_type`) between 1 and 120)),
  CONSTRAINT `chk_asset_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `asset_relation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_relation_identity` (`source_asset_id`,`target_asset_id`,`relation`),
  KEY `fk_asset_relation_source` (`workspace_id`,`source_asset_id`),
  KEY `fk_asset_relation_created_by` (`created_by_principal_id`),
  KEY `ix_asset_relation_target` (`workspace_id`,`target_asset_id`,`relation`,`source_asset_id`),
  CONSTRAINT `fk_asset_relation_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_asset_relation_source` FOREIGN KEY (`workspace_id`, `source_asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `fk_asset_relation_target` FOREIGN KEY (`workspace_id`, `target_asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `chk_asset_relation` CHECK ((`relation` in (_ascii'variant_of',_ascii'template_of',_ascii'related_to',_ascii'channel_version_of',_ascii'language_version_of'))),
  CONSTRAINT `chk_asset_relation_not_self` CHECK ((`source_asset_id` <> `target_asset_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `attempt_completion` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `completion_request_key` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `manifest_schema_version` smallint unsigned NOT NULL,
  `completion_manifest_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `output_count` int unsigned NOT NULL,
  `initial_usage_entry_count` int unsigned NOT NULL,
  `terminal_outbox_event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `completed_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attempt_completion_attempt` (`capability_attempt_id`),
  UNIQUE KEY `uq_attempt_completion_run` (`capability_run_id`),
  UNIQUE KEY `uq_attempt_completion_request` (`workspace_id`,`completion_request_key`),
  UNIQUE KEY `uq_attempt_completion_outbox` (`terminal_outbox_event_id`),
  UNIQUE KEY `uq_attempt_completion_usage_scope` (`workspace_id`,`capability_attempt_id`,`id`),
  KEY `fk_attempt_completion_attempt_scope` (`workspace_id`,`capability_run_id`,`capability_attempt_id`),
  KEY `fk_attempt_completion_outbox_scope` (`workspace_id`,`terminal_outbox_event_id`),
  KEY `ix_attempt_completion_workspace` (`workspace_id`,`completed_at`,`id`),
  CONSTRAINT `fk_attempt_completion_attempt_scope` FOREIGN KEY (`workspace_id`, `capability_run_id`, `capability_attempt_id`) REFERENCES `capability_attempt` (`workspace_id`, `capability_run_id`, `id`),
  CONSTRAINT `fk_attempt_completion_outbox_scope` FOREIGN KEY (`workspace_id`, `terminal_outbox_event_id`) REFERENCES `outbox_event` (`workspace_id`, `id`),
  CONSTRAINT `fk_attempt_completion_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_attempt_completion_manifest` CHECK (((`manifest_schema_version` = 1) and regexp_like(`completion_manifest_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_attempt_completion_request_key` CHECK ((`completion_request_key` = `capability_attempt_id`)),
  CONSTRAINT `chk_attempt_completion_timestamps` CHECK ((`completed_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `attempt_output` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `output_role` varchar(80) NOT NULL,
  `output_index` int unsigned NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attempt_output_role` (`capability_attempt_id`,`output_role`,`output_index`),
  KEY `fk_attempt_output_artifact` (`artifact_id`),
  KEY `fk_attempt_output_attempt_scope` (`workspace_id`,`capability_attempt_id`),
  KEY `fk_attempt_output_artifact_scope` (`workspace_id`,`artifact_id`),
  CONSTRAINT `fk_attempt_output_artifact_scope` FOREIGN KEY (`workspace_id`, `artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_attempt_output_attempt_scope` FOREIGN KEY (`workspace_id`, `capability_attempt_id`) REFERENCES `capability_attempt` (`workspace_id`, `id`),
  CONSTRAINT `fk_attempt_output_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_event` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `authority_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `authority_version` int unsigned DEFAULT NULL,
  `authorization_model_version` int unsigned NOT NULL,
  `event_type` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `authorization_decision_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_type` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `outcome` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `severity` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_id` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `trace_id` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `details` json NOT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  `integrity_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_audit_event_workspace` (`organization_id`,`workspace_id`),
  KEY `ix_audit_event_workspace_timeline` (`workspace_id`,`recorded_at`,`id`),
  KEY `ix_audit_event_organization_timeline` (`organization_id`,`recorded_at`,`id`),
  KEY `ix_audit_event_actor_timeline` (`actor_principal_id`,`recorded_at`,`id`),
  KEY `ix_audit_event_resource_timeline` (`resource_type`,`resource_id`,`recorded_at`,`id`),
  CONSTRAINT `fk_audit_event_actor` FOREIGN KEY (`actor_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_audit_event_organization` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`),
  CONSTRAINT `fk_audit_event_workspace` FOREIGN KEY (`organization_id`, `workspace_id`) REFERENCES `workspace` (`organization_id`, `id`),
  CONSTRAINT `chk_audit_event_actor` CHECK ((((`actor_type` in (_ascii'human',_ascii'service')) and (`actor_principal_id` is not null)) or ((`actor_type` = _ascii'system') and (`actor_principal_id` is null)))),
  CONSTRAINT `chk_audit_event_authentication` CHECK ((((`authentication_ref_type` = _ascii'none') and (`authentication_ref_hash` is null)) or ((`authentication_ref_type` in (_ascii'session',_ascii'service_api_token',_ascii'deployment',_ascii'cli_recovery')) and regexp_like(`authentication_ref_hash`,_ascii'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_audit_event_authority` CHECK ((((`authority_type` in (_ascii'human_membership',_ascii'service_grant',_ascii'instance_administrator')) and (`authority_id` is not null) and (`authority_version` >= 1)) or ((`authority_type` in (_ascii'system',_ascii'none')) and (`authority_id` is null) and (`authority_version` is null)))),
  CONSTRAINT `chk_audit_event_details_size` CHECK (((json_type(`details`) = _utf8mb4'OBJECT') and (length(cast(`details` as char charset utf8mb4)) <= 8192))),
  CONSTRAINT `chk_audit_event_digests` CHECK (((`schema_version` >= 1) and regexp_like(`authorization_decision_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`integrity_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_audit_event_outcome` CHECK ((`outcome` in (_ascii'succeeded',_ascii'denied',_ascii'failed'))),
  CONSTRAINT `chk_audit_event_scope` CHECK (((`workspace_id` is null) or (`organization_id` is not null))),
  CONSTRAINT `chk_audit_event_severity` CHECK ((`severity` in (_ascii'info',_ascii'warning',_ascii'high',_ascii'critical'))),
  CONSTRAINT `chk_audit_event_time` CHECK (((`authorization_model_version` >= 1) and (`recorded_at` >= `occurred_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_account` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `provider_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `access_token` mediumtext,
  `refresh_token` mediumtext,
  `id_token` mediumtext,
  `access_token_expires_at` datetime(3) DEFAULT NULL,
  `refresh_token_expires_at` datetime(3) DEFAULT NULL,
  `scope` mediumtext,
  `password` mediumtext,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_account_provider_subject` (`provider_id`,`account_id`),
  KEY `ix_auth_account_user` (`user_id`,`id`),
  CONSTRAINT `fk_auth_account_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_auth_account_identity` CHECK (((char_length(`provider_id`) between 1 and 80) and (char_length(`account_id`) between 1 and 255))),
  CONSTRAINT `chk_auth_account_time` CHECK (((`updated_at` >= `created_at`) and ((`access_token_expires_at` is null) or (`access_token_expires_at` >= `created_at`)) and ((`refresh_token_expires_at` is null) or (`refresh_token_expires_at` >= `created_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_rate_limit` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `key` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `count` bigint unsigned NOT NULL,
  `last_request` bigint unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_rate_limit_key` (`key`),
  KEY `ix_auth_rate_limit_last_request` (`last_request`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_session` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `token` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `ip_address` varchar(45) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `user_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_session_token` (`token`),
  KEY `ix_auth_session_user` (`user_id`,`expires_at`,`id`),
  CONSTRAINT `fk_auth_session_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_auth_session_time` CHECK (((`expires_at` > `created_at`) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_user` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email_verified` tinyint(1) NOT NULL,
  `image` mediumtext,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_user_email` (`email`),
  CONSTRAINT `chk_auth_user_email` CHECK ((char_length(`email`) between 3 and 320)),
  CONSTRAINT `chk_auth_user_name` CHECK ((char_length(`name`) between 1 and 255)),
  CONSTRAINT `chk_auth_user_time` CHECK ((`updated_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_verification` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `identifier` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `value` mediumtext NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_auth_verification_identifier` (`identifier`,`expires_at`,`id`),
  CONSTRAINT `chk_auth_verification_identity` CHECK ((char_length(`identifier`) between 1 and 320)),
  CONSTRAINT `chk_auth_verification_time` CHECK (((`expires_at` > `created_at`) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `brand_kit` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `lifecycle_status` varchar(16) NOT NULL,
  `default_marker` tinyint(1) DEFAULT NULL,
  `latest_published_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `creation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_brand_kit_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_brand_kit_creation_request` (`workspace_id`,`creation_request_key`),
  UNIQUE KEY `uq_brand_kit_default` (`workspace_id`,`default_marker`),
  KEY `fk_brand_kit_created_by` (`created_by_principal_id`),
  KEY `fk_brand_kit_updated_by` (`updated_by_principal_id`),
  KEY `ix_brand_kit_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_brand_kit_latest_revision` (`workspace_id`,`id`,`latest_published_revision_id`),
  CONSTRAINT `fk_brand_kit_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_brand_kit_latest_revision` FOREIGN KEY (`workspace_id`, `id`, `latest_published_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `brand_kit_id`, `id`),
  CONSTRAINT `fk_brand_kit_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_brand_kit_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_brand_kit_default_marker` CHECK (((`default_marker` is null) or (`default_marker` = true))),
  CONSTRAINT `chk_brand_kit_status` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'archived'))),
  CONSTRAINT `chk_brand_kit_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `brand_kit_draft` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_kit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `content_document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`brand_kit_id`),
  KEY `fk_brand_kit_draft_created_by` (`created_by_principal_id`),
  KEY `fk_brand_kit_draft_updated_by` (`updated_by_principal_id`),
  CONSTRAINT `fk_brand_kit_draft_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_brand_kit_draft_kit` FOREIGN KEY (`workspace_id`, `brand_kit_id`) REFERENCES `brand_kit` (`workspace_id`, `id`),
  CONSTRAINT `fk_brand_kit_draft_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_brand_kit_draft_schema` CHECK ((`schema_version` = 1)),
  CONSTRAINT `chk_brand_kit_draft_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `brand_kit_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_kit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_number` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `content_document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_brand_kit_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_brand_kit_revision_scoped_id` (`workspace_id`,`brand_kit_id`,`id`),
  UNIQUE KEY `uq_brand_kit_revision_number` (`workspace_id`,`brand_kit_id`,`revision_number`),
  UNIQUE KEY `uq_brand_kit_revision_digest` (`workspace_id`,`brand_kit_id`,`content_digest`),
  UNIQUE KEY `uq_brand_kit_publication_request` (`workspace_id`,`publication_request_key`),
  KEY `fk_brand_kit_revision_published_by` (`published_by_principal_id`),
  KEY `ix_brand_kit_revision_recent` (`workspace_id`,`brand_kit_id`,`revision_number`),
  CONSTRAINT `fk_brand_kit_revision_kit` FOREIGN KEY (`workspace_id`, `brand_kit_id`) REFERENCES `brand_kit` (`workspace_id`, `id`),
  CONSTRAINT `fk_brand_kit_revision_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_brand_kit_revision_number` CHECK ((`revision_number` >= 1)),
  CONSTRAINT `chk_brand_kit_revision_schema` CHECK ((`schema_version` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `brand_kit_revision_artifact_reference` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_kit_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference_role` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` smallint unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`brand_kit_revision_id`,`reference_key`),
  UNIQUE KEY `uq_brand_revision_reference_position` (`workspace_id`,`brand_kit_revision_id`,`position`),
  KEY `fk_brand_revision_reference_artifact` (`workspace_id`,`asset_id`,`artifact_id`),
  KEY `ix_brand_revision_reference_artifact` (`workspace_id`,`artifact_id`,`brand_kit_revision_id`),
  CONSTRAINT `fk_brand_revision_reference_artifact` FOREIGN KEY (`workspace_id`, `asset_id`, `artifact_id`) REFERENCES `artifact` (`workspace_id`, `asset_id`, `id`),
  CONSTRAINT `fk_brand_revision_reference_revision` FOREIGN KEY (`workspace_id`, `brand_kit_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_brand_revision_reference_role` CHECK ((`reference_role` in (_utf8mb4'primary',_utf8mb4'inverse',_utf8mb4'icon',_utf8mb4'reference')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `browser_attempt_assignment` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `browser_executor_session_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_lease_generation` int unsigned NOT NULL,
  `execution_generation` int unsigned NOT NULL,
  `attempt_grant_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stable_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `claimed_at` datetime(3) NOT NULL,
  `last_heartbeat_at` datetime(3) NOT NULL,
  `lease_expires_at` datetime(3) NOT NULL,
  `terminal_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_browser_attempt_assignment_attempt` (`capability_attempt_id`),
  UNIQUE KEY `uq_browser_attempt_assignment_grant_token` (`attempt_grant_token_hash`),
  KEY `ix_browser_attempt_assignment_session` (`browser_executor_session_id`,`state`,`lease_expires_at`,`id`),
  KEY `ix_browser_attempt_assignment_reconcile` (`workspace_id`,`state`,`lease_expires_at`,`id`),
  CONSTRAINT `fk_browser_attempt_assignment_attempt` FOREIGN KEY (`capability_attempt_id`) REFERENCES `capability_attempt` (`id`),
  CONSTRAINT `fk_browser_attempt_assignment_session` FOREIGN KEY (`browser_executor_session_id`) REFERENCES `browser_executor_session` (`id`),
  CONSTRAINT `fk_browser_attempt_assignment_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_browser_attempt_assignment_generations` CHECK (((`attempt_lease_generation` >= 1) and (`execution_generation` >= 1))),
  CONSTRAINT `chk_browser_attempt_assignment_grant_token` CHECK (regexp_like(`attempt_grant_token_hash`,_ascii'^[0-9a-f]{64}$')),
  CONSTRAINT `chk_browser_attempt_assignment_reason` CHECK (((`stable_reason_code` is null) or (char_length(`stable_reason_code`) between 1 and 120))),
  CONSTRAINT `chk_browser_attempt_assignment_state` CHECK ((`state` in (_ascii'active',_ascii'cancel_requested',_ascii'completed',_ascii'cancelled',_ascii'failed',_ascii'fenced',_ascii'expired',_ascii'revoked'))),
  CONSTRAINT `chk_browser_attempt_assignment_terminal` CHECK ((((`state` in (_ascii'active',_ascii'cancel_requested')) and (`terminal_at` is null)) or ((`state` in (_ascii'completed',_ascii'cancelled',_ascii'failed',_ascii'fenced',_ascii'expired',_ascii'revoked')) and (`terminal_at` is not null)))),
  CONSTRAINT `chk_browser_attempt_assignment_timestamps` CHECK (((`claimed_at` >= `created_at`) and (`last_heartbeat_at` >= `claimed_at`) and (`lease_expires_at` >= `last_heartbeat_at`) and (`updated_at` >= `last_heartbeat_at`) and ((`terminal_at` is null) or ((`terminal_at` >= `claimed_at`) and (`updated_at` >= `terminal_at`)))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `browser_attempt_assignment_event` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `browser_attempt_assignment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_lease_generation` int unsigned NOT NULL,
  `execution_generation` int unsigned NOT NULL,
  `stable_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_browser_assignment_event_key` (`browser_attempt_assignment_id`,`event_key`),
  KEY `ix_browser_assignment_event_timeline` (`browser_attempt_assignment_id`,`recorded_at`,`id`),
  KEY `ix_browser_assignment_event_workspace` (`workspace_id`,`recorded_at`,`id`),
  CONSTRAINT `fk_browser_assignment_event_assignment` FOREIGN KEY (`browser_attempt_assignment_id`) REFERENCES `browser_attempt_assignment` (`id`),
  CONSTRAINT `fk_browser_assignment_event_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_browser_assignment_event_identity` CHECK (((char_length(`event_key`) between 1 and 160) and (`attempt_lease_generation` >= 1) and (`execution_generation` >= 1))),
  CONSTRAINT `chk_browser_assignment_event_reason` CHECK (((`stable_reason_code` is null) or (char_length(`stable_reason_code`) between 1 and 120))),
  CONSTRAINT `chk_browser_assignment_event_timestamps` CHECK ((`recorded_at` >= `occurred_at`)),
  CONSTRAINT `chk_browser_assignment_event_type` CHECK ((`event_type` in (_ascii'claimed',_ascii'cancel_signaled',_ascii'completed',_ascii'cancelled',_ascii'failed',_ascii'fenced',_ascii'expired',_ascii'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `browser_executor_capability` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `browser_executor_session_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `backend` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `probe_profile_version` int unsigned NOT NULL,
  `probe_result_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `declared_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_browser_executor_capability_session_implementation` (`browser_executor_session_id`,`implementation_revision_id`),
  KEY `fk_browser_executor_capability_implementation` (`implementation_revision_id`),
  KEY `ix_browser_executor_capability_lookup` (`workspace_id`,`implementation_revision_id`,`backend`,`browser_executor_session_id`),
  CONSTRAINT `fk_browser_executor_capability_implementation` FOREIGN KEY (`implementation_revision_id`) REFERENCES `capability_implementation_revision` (`id`),
  CONSTRAINT `fk_browser_executor_capability_session` FOREIGN KEY (`browser_executor_session_id`) REFERENCES `browser_executor_session` (`id`),
  CONSTRAINT `fk_browser_executor_capability_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_browser_executor_capability_backend` CHECK ((`backend` in (_ascii'webgpu',_ascii'wasm',_ascii'javascript'))),
  CONSTRAINT `chk_browser_executor_capability_identity` CHECK (((char_length(`adapter_key`) between 1 and 160) and regexp_like(`implementation_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`probe_profile_version` >= 1) and regexp_like(`probe_result_digest`,_ascii'^sha256:[0-9a-f]{64}$')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `browser_executor_session` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_version` int unsigned NOT NULL,
  `runtime_release_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_release_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_manifest_version` int unsigned NOT NULL,
  `capability_manifest_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `last_seen_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `terminal_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_browser_executor_session_workspace_state` (`workspace_id`,`state`,`expires_at`,`id`),
  KEY `ix_browser_executor_session_expiry` (`state`,`expires_at`,`id`),
  KEY `ix_browser_executor_session_authentication_ref` (`workspace_id`,`authentication_ref_hash`),
  CONSTRAINT `fk_browser_executor_session_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_browser_executor_session_hashes` CHECK ((regexp_like(`authentication_ref_hash`,_ascii'^[0-9a-f]{64}$') and regexp_like(`runtime_release_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`capability_manifest_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_browser_executor_session_state` CHECK ((`state` in (_ascii'active',_ascii'draining',_ascii'revoked',_ascii'closed'))),
  CONSTRAINT `chk_browser_executor_session_terminal` CHECK ((((`state` in (_ascii'active',_ascii'draining')) and (`terminal_at` is null)) or ((`state` in (_ascii'revoked',_ascii'closed')) and (`terminal_at` is not null)))),
  CONSTRAINT `chk_browser_executor_session_timestamps` CHECK (((`last_seen_at` >= `created_at`) and (`expires_at` >= `created_at`) and (`updated_at` >= `last_seen_at`) and ((`terminal_at` is null) or ((`terminal_at` >= `created_at`) and (`updated_at` >= `terminal_at`))))),
  CONSTRAINT `chk_browser_executor_session_versions` CHECK (((`authority_version` >= 1) and (`capability_manifest_version` >= 1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `budget_account` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `period_start_at` datetime(3) NOT NULL,
  `period_end_at` datetime(3) NOT NULL,
  `hard_limit_amount` decimal(36,12) NOT NULL,
  `consumed_amount` decimal(36,12) NOT NULL,
  `reserved_amount` decimal(36,12) NOT NULL,
  `unknown_held_amount` decimal(36,12) NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budget_account_period` (`workspace_id`,`account_key`,`period_start_at`),
  UNIQUE KEY `uq_budget_account_workspace_id` (`workspace_id`,`id`),
  KEY `fk_budget_account_created_by` (`created_by_principal_id`),
  KEY `ix_budget_account_active` (`workspace_id`,`lifecycle_status`,`period_end_at`,`id`),
  CONSTRAINT `fk_budget_account_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_budget_account_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_budget_account_amounts` CHECK (((`hard_limit_amount` >= 0) and (`consumed_amount` >= 0) and (`reserved_amount` >= 0) and (`unknown_held_amount` >= 0))),
  CONSTRAINT `chk_budget_account_identity` CHECK (((char_length(`account_key`) between 1 and 160) and regexp_like(`currency_code`,_ascii'^[A-Z]{3}$') and (`period_end_at` > `period_start_at`))),
  CONSTRAINT `chk_budget_account_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'frozen',_ascii'exhausted',_ascii'closed'))),
  CONSTRAINT `chk_budget_account_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `budget_ledger_entry` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `budget_account_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `budget_reservation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `entry_key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entry_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reserved_delta` decimal(36,12) NOT NULL,
  `consumed_delta` decimal(36,12) NOT NULL,
  `unknown_held_delta` decimal(36,12) NOT NULL,
  `reserved_balance_after` decimal(36,12) NOT NULL,
  `consumed_balance_after` decimal(36,12) NOT NULL,
  `unknown_held_balance_after` decimal(36,12) NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence` json NOT NULL,
  `corrects_entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budget_ledger_entry_key` (`budget_account_id`,`entry_key`),
  UNIQUE KEY `uq_budget_ledger_workspace_account_id` (`workspace_id`,`budget_account_id`,`id`),
  KEY `fk_budget_ledger_reservation` (`workspace_id`,`budget_reservation_id`),
  KEY `fk_budget_ledger_created_by` (`created_by_principal_id`),
  KEY `ix_budget_ledger_reservation` (`budget_reservation_id`,`recorded_at`,`id`),
  KEY `ix_budget_ledger_timeline` (`workspace_id`,`budget_account_id`,`recorded_at`,`id`),
  KEY `fk_budget_ledger_correction` (`workspace_id`,`budget_account_id`,`corrects_entry_id`),
  CONSTRAINT `fk_budget_ledger_account` FOREIGN KEY (`workspace_id`, `budget_account_id`) REFERENCES `budget_account` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_ledger_correction` FOREIGN KEY (`workspace_id`, `budget_account_id`, `corrects_entry_id`) REFERENCES `budget_ledger_entry` (`workspace_id`, `budget_account_id`, `id`),
  CONSTRAINT `fk_budget_ledger_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_budget_ledger_reservation` FOREIGN KEY (`workspace_id`, `budget_reservation_id`) REFERENCES `budget_reservation` (`workspace_id`, `id`),
  CONSTRAINT `chk_budget_ledger_balances` CHECK (((`reserved_balance_after` >= 0) and (`consumed_balance_after` >= 0) and (`unknown_held_balance_after` >= 0))),
  CONSTRAINT `chk_budget_ledger_correction` CHECK ((((`entry_kind` = _ascii'adjustment') and (`corrects_entry_id` is not null) and (`corrects_entry_id` <> `id`)) or ((`entry_kind` <> _ascii'adjustment') and (`corrects_entry_id` is null)))),
  CONSTRAINT `chk_budget_ledger_identity` CHECK (((char_length(`entry_key`) between 1 and 191) and regexp_like(`currency_code`,_ascii'^[A-Z]{3}$') and regexp_like(`request_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (json_type(`evidence`) = _utf8mb4'OBJECT'))),
  CONSTRAINT `chk_budget_ledger_kind` CHECK ((`entry_kind` in (_ascii'reserve',_ascii'consume',_ascii'release',_ascii'unknown_hold',_ascii'unknown_resolve',_ascii'adjustment',_ascii'expire'))),
  CONSTRAINT `chk_budget_ledger_time` CHECK ((`recorded_at` >= `occurred_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `budget_reservation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `budget_account_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reservation_key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `agent_model_call_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pricing_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reserved_amount` decimal(36,12) NOT NULL,
  `settled_amount` decimal(36,12) DEFAULT NULL,
  `unknown_hold_amount` decimal(36,12) DEFAULT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `settled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budget_reservation_key` (`budget_account_id`,`reservation_key`),
  UNIQUE KEY `uq_budget_reservation_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_budget_reservation_attempt` (`capability_attempt_id`),
  UNIQUE KEY `uq_budget_reservation_agent_model_call` (`agent_model_call_id`),
  KEY `fk_budget_reservation_account` (`workspace_id`,`budget_account_id`),
  KEY `fk_budget_reservation_capability` (`workspace_id`,`capability_run_id`),
  KEY `fk_budget_reservation_attempt` (`workspace_id`,`capability_attempt_id`),
  KEY `fk_budget_reservation_pricing` (`workspace_id`,`pricing_revision_id`),
  KEY `ix_budget_reservation_expiry` (`lifecycle_status`,`expires_at`,`id`),
  KEY `ix_budget_reservation_run` (`workspace_id`,`workflow_run_id`,`lifecycle_status`,`id`),
  KEY `ix_budget_reservation_agent_run` (`workspace_id`,`agent_model_call_id`,`lifecycle_status`,`id`),
  CONSTRAINT `fk_budget_reservation_account` FOREIGN KEY (`workspace_id`, `budget_account_id`) REFERENCES `budget_account` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_reservation_agent_model_call` FOREIGN KEY (`workspace_id`, `agent_model_call_id`) REFERENCES `agent_model_call` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_reservation_attempt` FOREIGN KEY (`workspace_id`, `capability_attempt_id`) REFERENCES `capability_attempt` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_reservation_capability` FOREIGN KEY (`workspace_id`, `capability_run_id`) REFERENCES `capability_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_reservation_pricing` FOREIGN KEY (`workspace_id`, `pricing_revision_id`) REFERENCES `pricing_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_budget_reservation_workflow` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_run` (`workspace_id`, `id`),
  CONSTRAINT `chk_budget_reservation_identity` CHECK (((char_length(`reservation_key`) between 1 and 191) and regexp_like(`request_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`currency_code`,_ascii'^[A-Z]{3}$') and (`reserved_amount` >= 0))),
  CONSTRAINT `chk_budget_reservation_lifecycle` CHECK ((`lifecycle_status` in (_ascii'reserved',_ascii'consuming',_ascii'settled',_ascii'released',_ascii'unknown'))),
  CONSTRAINT `chk_budget_reservation_terminal` CHECK ((((`lifecycle_status` = _ascii'settled') and (`settled_amount` is not null) and (`settled_amount` >= 0) and (`unknown_hold_amount` is null) and (`settled_at` is not null)) or ((`lifecycle_status` = _ascii'unknown') and (`settled_amount` is null) and (`unknown_hold_amount` is not null) and (`unknown_hold_amount` >= 0) and (`settled_at` is not null)) or ((`lifecycle_status` = _ascii'released') and (`settled_amount` is null) and (`unknown_hold_amount` is null) and (`settled_at` is not null)) or ((`lifecycle_status` in (_ascii'reserved',_ascii'consuming')) and (`settled_amount` is null) and (`unknown_hold_amount` is null) and (`settled_at` is null)))),
  CONSTRAINT `chk_budget_reservation_time` CHECK (((`expires_at` > `created_at`) and (`updated_at` >= `created_at`) and (`version` >= 1) and ((`settled_at` is null) or (`settled_at` >= `created_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `canonical_model` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `slug` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_reference` varchar(512) DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canonical_model_slug` (`workspace_id`,`slug`),
  UNIQUE KEY `uq_canonical_model_workspace_id` (`workspace_id`,`id`),
  KEY `fk_canonical_model_created_by` (`created_by_principal_id`),
  KEY `fk_canonical_model_updated_by` (`updated_by_principal_id`),
  KEY `ix_canonical_model_lifecycle` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_canonical_model_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canonical_model_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canonical_model_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_canonical_model_identity` CHECK (((char_length(`slug`) between 1 and 160) and regexp_like(`slug`,_ascii'^[A-Za-z0-9][A-Za-z0-9._/-]*$') and (`source_kind` in (_ascii'models_dev',_ascii'provider',_ascii'manual')) and ((`source_reference` is null) or (char_length(`source_reference`) <= 512)) and (`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_canonical_model_lifecycle` CHECK (((`lifecycle_status` in (_ascii'draft',_ascii'active',_ascii'disabled',_ascii'revoked')) and ((`activated_at` is null) or (`activated_at` >= `created_at`)) and ((`disabled_at` is null) or (`disabled_at` >= `created_at`)) and ((`revoked_at` is null) or (`revoked_at` >= `created_at`)) and (((`lifecycle_status` = _ascii'draft') and (`activated_at` is null) and (`disabled_at` is null) and (`revoked_at` is null)) or ((`lifecycle_status` = _ascii'active') and (`activated_at` is not null) and (`disabled_at` is null) and (`revoked_at` is null)) or ((`lifecycle_status` = _ascii'disabled') and (`activated_at` is not null) and (`disabled_at` is not null) and (`revoked_at` is null)) or ((`lifecycle_status` = _ascii'revoked') and (`revoked_at` is not null)))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `canvas_draft` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_kit_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `title` varchar(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `schema_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `create_request_key` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `create_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canvas_draft_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_canvas_draft_create_request` (`workspace_id`,`create_request_key`),
  KEY `fk_canvas_draft_creator` (`created_by_principal_id`),
  KEY `fk_canvas_draft_updater` (`updated_by_principal_id`),
  KEY `ix_canvas_draft_workspace_updated` (`workspace_id`,`updated_at`,`id`),
  KEY `ix_canvas_draft_brand_revision` (`workspace_id`,`brand_kit_revision_id`,`updated_at`,`id`),
  CONSTRAINT `fk_canvas_draft_brand_revision` FOREIGN KEY (`workspace_id`, `brand_kit_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_canvas_draft_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canvas_draft_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canvas_draft_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_canvas_draft_content_digest` CHECK (regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_canvas_draft_request_hash` CHECK (regexp_like(`create_request_hash`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_canvas_draft_request_key` CHECK (regexp_like(`create_request_key`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_canvas_draft_schema_version` CHECK ((`schema_version` = _ascii'kanvas.editor-document/v1')),
  CONSTRAINT `chk_canvas_draft_title` CHECK ((char_length(`title`) between 1 and 240)),
  CONSTRAINT `chk_canvas_draft_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `canvas_draft_artifact_reference` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canvas_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference_role` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canvas_draft_reference_identity` (`workspace_id`,`canvas_draft_id`,`artifact_id`,`reference_role`),
  KEY `fk_canvas_draft_reference_actor` (`created_by_principal_id`),
  KEY `ix_canvas_draft_reference_artifact` (`workspace_id`,`artifact_id`,`canvas_draft_id`),
  CONSTRAINT `fk_canvas_draft_reference_actor` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canvas_draft_reference_artifact` FOREIGN KEY (`workspace_id`, `artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_canvas_draft_reference_draft` FOREIGN KEY (`workspace_id`, `canvas_draft_id`) REFERENCES `canvas_draft` (`workspace_id`, `id`),
  CONSTRAINT `chk_canvas_draft_reference_role` CHECK ((`reference_role` in (_ascii'editor.image.source',_ascii'editor.page.background',_ascii'editor.graphic.source',_ascii'editor.frame.content',_ascii'editor.grid.content')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `canvas_draft_revision` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canvas_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `brand_kit_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `title` varchar(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `schema_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `restored_from_version` int unsigned DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`canvas_draft_id`,`version`),
  KEY `fk_canvas_draft_revision_creator` (`created_by_principal_id`),
  KEY `ix_canvas_draft_revision_recent` (`workspace_id`,`canvas_draft_id`,`version` DESC),
  KEY `ix_canvas_draft_history_brand_revision` (`workspace_id`,`brand_kit_revision_id`,`canvas_draft_id`,`version`),
  CONSTRAINT `fk_canvas_draft_history_brand_revision` FOREIGN KEY (`workspace_id`, `brand_kit_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_canvas_draft_revision_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_canvas_draft_revision_draft` FOREIGN KEY (`workspace_id`, `canvas_draft_id`) REFERENCES `canvas_draft` (`workspace_id`, `id`),
  CONSTRAINT `chk_canvas_draft_revision_digest` CHECK (regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_canvas_draft_revision_kind` CHECK ((`revision_kind` in (_ascii'save',_ascii'restore',_ascii'brand_update'))),
  CONSTRAINT `chk_canvas_draft_revision_restore` CHECK ((((`revision_kind` in (_ascii'save',_ascii'brand_update')) and (`restored_from_version` is null)) or ((`revision_kind` = _ascii'restore') and (`restored_from_version` is not null) and (`restored_from_version` >= 1) and (`restored_from_version` < `version`)))),
  CONSTRAINT `chk_canvas_draft_revision_schema` CHECK ((`schema_version` = _ascii'kanvas.editor-document/v1')),
  CONSTRAINT `chk_canvas_draft_revision_title` CHECK ((char_length(`title`) between 1 and 240)),
  CONSTRAINT `chk_canvas_draft_revision_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_attempt` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `binding_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `route_candidate_index` smallint unsigned NOT NULL,
  `candidate_attempt_number` smallint unsigned NOT NULL,
  `transition_kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `transition_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_number` int unsigned NOT NULL,
  `execution_target` varchar(24) NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `side_effect_state` varchar(24) NOT NULL,
  `retry_disposition` varchar(24) DEFAULT NULL,
  `not_before` datetime(3) NOT NULL,
  `lease_generation` int unsigned NOT NULL DEFAULT '0',
  `lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_expires_at` datetime(3) DEFAULT NULL,
  `execution_deadline_at` datetime(3) DEFAULT NULL,
  `cancel_requested_at` datetime(3) DEFAULT NULL,
  `cancel_deadline_at` datetime(3) DEFAULT NULL,
  `completion_manifest_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `error` json DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_attempt_number` (`capability_run_id`,`attempt_number`),
  UNIQUE KEY `uq_cap_attempt_completion_scope` (`workspace_id`,`capability_run_id`,`id`),
  UNIQUE KEY `uq_cap_attempt_candidate_attempt` (`capability_run_id`,`route_candidate_index`,`candidate_attempt_number`),
  UNIQUE KEY `uq_cap_attempt_workspace_id` (`workspace_id`,`id`),
  KEY `fk_cap_attempt_impl` (`implementation_revision_id`),
  KEY `ix_cap_attempt_claim` (`workspace_id`,`lifecycle_status`,`not_before`),
  KEY `ix_capability_attempt_reconcile` (`lifecycle_status`,`lease_expires_at`,`updated_at`,`id`),
  KEY `ix_capability_attempt_cancel` (`lifecycle_status`,`cancel_deadline_at`,`id`),
  KEY `ix_capability_attempt_browser_claim` (`workspace_id`,`execution_target`,`lifecycle_status`,`not_before`,`id`),
  KEY `fk_cap_attempt_binding_scope` (`workspace_id`,`binding_id`),
  KEY `ix_cap_attempt_current_route` (`workspace_id`,`capability_run_id`,`route_candidate_index`,`candidate_attempt_number`,`lifecycle_status`),
  CONSTRAINT `fk_cap_attempt_binding_scope` FOREIGN KEY (`workspace_id`, `binding_id`) REFERENCES `capability_binding` (`workspace_id`, `id`),
  CONSTRAINT `fk_cap_attempt_impl` FOREIGN KEY (`implementation_revision_id`) REFERENCES `capability_implementation_revision` (`id`),
  CONSTRAINT `fk_cap_attempt_run` FOREIGN KEY (`capability_run_id`) REFERENCES `capability_run` (`id`),
  CONSTRAINT `fk_cap_attempt_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_attempt_candidate_attempt` CHECK ((`candidate_attempt_number` between 1 and 10)),
  CONSTRAINT `chk_cap_attempt_completion_manifest_digest` CHECK (((`completion_manifest_hash` is null) or regexp_like(`completion_manifest_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_cap_attempt_retry` CHECK (((`retry_disposition` is null) or (`retry_disposition` in (_utf8mb4'retryable',_utf8mb4'terminal',_utf8mb4'manual')))),
  CONSTRAINT `chk_cap_attempt_route_candidate` CHECK ((`route_candidate_index` between 0 and 31)),
  CONSTRAINT `chk_cap_attempt_side_effect` CHECK ((`side_effect_state` in (_utf8mb4'not_started',_utf8mb4'started',_utf8mb4'committed',_utf8mb4'unknown'))),
  CONSTRAINT `chk_cap_attempt_status` CHECK ((`lifecycle_status` in (_utf8mb4'created',_utf8mb4'running',_utf8mb4'completed',_utf8mb4'failed',_utf8mb4'cancelled',_utf8mb4'abandoned'))),
  CONSTRAINT `chk_cap_attempt_target` CHECK ((`execution_target` in (_utf8mb4'browser',_utf8mb4'worker',_utf8mb4'provider'))),
  CONSTRAINT `chk_cap_attempt_transition_kind` CHECK ((`transition_kind` in (_ascii'initial',_ascii'retry',_ascii'fallback'))),
  CONSTRAINT `chk_cap_attempt_transition_reason` CHECK (((char_length(`transition_reason_code`) between 1 and 120) and regexp_like(`transition_reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]*$'))),
  CONSTRAINT `chk_cap_attempt_transition_shape` CHECK ((((`transition_kind` = _ascii'initial') and (`attempt_number` = 1) and (`route_candidate_index` = 0) and (`candidate_attempt_number` = 1)) or ((`transition_kind` = _ascii'retry') and (`attempt_number` > 1) and (`candidate_attempt_number` between 2 and 10) and (`attempt_number` >= `candidate_attempt_number`)) or ((`transition_kind` = _ascii'fallback') and (`attempt_number` > 1) and (`route_candidate_index` between 1 and 31) and (`candidate_attempt_number` = 1)))),
  CONSTRAINT `chk_capability_attempt_cancel_facts` CHECK ((((`cancel_requested_at` is null) and (`cancel_deadline_at` is null)) or ((`cancel_requested_at` is not null) and (`cancel_deadline_at` is not null) and (`cancel_deadline_at` >= `cancel_requested_at`)))),
  CONSTRAINT `chk_capability_attempt_cancel_state` CHECK (((`lifecycle_status` <> _utf8mb4'cancelled') or (`cancel_requested_at` is not null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_binding` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `binding_key` varchar(160) NOT NULL,
  `contract_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `priority` int unsigned NOT NULL,
  `version` int unsigned NOT NULL,
  `route_policy` json NOT NULL,
  `route_policy_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_binding_priority` (`workspace_id`,`contract_revision_id`,`priority`),
  UNIQUE KEY `uq_cap_binding_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_binding_key` (`workspace_id`,`binding_key`),
  KEY `fk_cap_binding_contract` (`contract_revision_id`),
  KEY `fk_cap_binding_impl` (`implementation_revision_id`),
  KEY `ix_cap_binding_lookup` (`workspace_id`,`contract_revision_id`,`lifecycle_status`),
  KEY `fk_capability_binding_route_policy` (`workspace_id`,`route_policy_revision_id`),
  CONSTRAINT `fk_cap_binding_contract` FOREIGN KEY (`contract_revision_id`) REFERENCES `capability_contract_revision` (`id`),
  CONSTRAINT `fk_cap_binding_impl` FOREIGN KEY (`implementation_revision_id`) REFERENCES `capability_implementation_revision` (`id`),
  CONSTRAINT `fk_cap_binding_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `fk_capability_binding_route_policy` FOREIGN KEY (`workspace_id`, `route_policy_revision_id`) REFERENCES `route_policy_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_cap_binding_status` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'disabled',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_catalog_entry` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recommendation_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `package_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `package_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `package_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document` json NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_catalog_entry_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_catalog_entry_revision` (`workspace_id`,`recommendation_key`,`package_version`),
  KEY `ix_cap_catalog_entry_list` (`workspace_id`,`lifecycle_status`,`capability_key`,`updated_at`),
  CONSTRAINT `fk_cap_catalog_entry_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_catalog_entry_identity` CHECK ((regexp_like(`recommendation_key`,_utf8mb4'^[a-z0-9]+([._:-][a-z0-9]+)+$') and regexp_like(`capability_key`,_utf8mb4'^[a-z0-9]+([._-][a-z0-9]+)+$') and regexp_like(`package_key`,_utf8mb4'^[a-z0-9]+([._:-][a-z0-9]+)+$') and regexp_like(`package_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$') and regexp_like(`canonical_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$') and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_cap_catalog_entry_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'retired')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_contract_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `contract_key` varchar(160) NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_schema` json NOT NULL,
  `output_schema` json NOT NULL,
  `presentation` json DEFAULT NULL,
  `idempotency_mode` varchar(24) NOT NULL,
  `supported_invokers` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_contract_revision` (`workspace_id`,`contract_key`,`revision`),
  UNIQUE KEY `uq_cap_contract_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_cap_contract_workspace_id` (`workspace_id`,`id`),
  CONSTRAINT `fk_cap_contract_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_contract_idempotency` CHECK ((`idempotency_mode` in (_utf8mb4'intrinsic',_utf8mb4'keyed',_utf8mb4'non_idempotent'))),
  CONSTRAINT `chk_cap_contract_status` CHECK ((`lifecycle_status` in (_utf8mb4'draft',_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_declaration_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `contract_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `declaration` json NOT NULL,
  `publication_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_declaration_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_declaration_definition_id` (`workspace_id`,`capability_definition_id`,`id`),
  UNIQUE KEY `uq_cap_declaration_revision` (`workspace_id`,`capability_definition_id`,`revision`),
  UNIQUE KEY `uq_cap_declaration_publication_request` (`workspace_id`,`publication_request_key`),
  KEY `ix_cap_declaration_contract` (`workspace_id`,`contract_revision_id`),
  CONSTRAINT `fk_cap_declaration_contract` FOREIGN KEY (`workspace_id`, `contract_revision_id`) REFERENCES `capability_contract_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_cap_declaration_definition` FOREIGN KEY (`workspace_id`, `capability_definition_id`) REFERENCES `capability_definition` (`workspace_id`, `id`),
  CONSTRAINT `chk_cap_declaration_identity` CHECK (((`revision` >= 1) and (`schema_version` = 1) and regexp_like(`canonical_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$') and regexp_like(`publication_request_hash`,_utf8mb4'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_cap_declaration_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'draft',_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked'))),
  CONSTRAINT `chk_cap_declaration_published` CHECK ((((`lifecycle_status` = _utf8mb4'draft') and (`published_at` is null)) or ((`lifecycle_status` <> _utf8mb4'draft') and (`published_at` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_definition` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `current_contract_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `current_declaration_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `create_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `create_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_definition_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_definition_key` (`workspace_id`,`capability_key`),
  UNIQUE KEY `uq_cap_definition_create_request` (`workspace_id`,`create_request_key`),
  KEY `ix_cap_definition_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_cap_definition_current_contract` (`workspace_id`,`current_contract_revision_id`),
  KEY `fk_cap_definition_current_declaration` (`workspace_id`,`id`,`current_declaration_revision_id`),
  CONSTRAINT `fk_cap_definition_current_contract` FOREIGN KEY (`workspace_id`, `current_contract_revision_id`) REFERENCES `capability_contract_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_cap_definition_current_declaration` FOREIGN KEY (`workspace_id`, `id`, `current_declaration_revision_id`) REFERENCES `capability_declaration_revision` (`workspace_id`, `capability_definition_id`, `id`),
  CONSTRAINT `fk_cap_definition_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_definition_archived` CHECK ((((`lifecycle_status` = _ascii'archived') and (`archived_at` is not null)) or ((`lifecycle_status` = _ascii'active') and (`archived_at` is null)))),
  CONSTRAINT `chk_cap_definition_identity` CHECK ((regexp_like(`capability_key`,_ascii'^[a-z0-9]+([._-][a-z0-9]+)+$') and regexp_like(`create_request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_cap_definition_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_implementation_model_resource` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_resource_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_role` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`implementation_revision_id`,`resource_role`),
  KEY `ix_cap_impl_model_resource_revision` (`workspace_id`,`model_resource_revision_id`,`implementation_revision_id`),
  CONSTRAINT `fk_cap_impl_model_resource_implementation` FOREIGN KEY (`workspace_id`, `implementation_revision_id`) REFERENCES `capability_implementation_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_cap_impl_model_resource_revision` FOREIGN KEY (`workspace_id`, `model_resource_revision_id`) REFERENCES `model_resource_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_cap_impl_model_resource_role` CHECK (regexp_like(`resource_role`,_utf8mb4'^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_implementation_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_key` varchar(160) NOT NULL,
  `display_name` json NOT NULL,
  `description` json DEFAULT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `contract_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_adapter_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_target` varchar(24) NOT NULL,
  `adapter_key` varchar(160) NOT NULL,
  `source_kind` varchar(32) NOT NULL,
  `source_reference` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_key` varchar(160) NOT NULL,
  `publication_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `configuration` json NOT NULL,
  `input_mapping` json NOT NULL,
  `input_mapping_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `compiled_input_mapping` json NOT NULL,
  `output_mapping` json NOT NULL,
  `output_mapping_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `compiled_output_mapping` json NOT NULL,
  `fixture_suite` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_impl_revision` (`workspace_id`,`implementation_key`,`revision`),
  UNIQUE KEY `uq_cap_impl_publication_request` (`workspace_id`,`publication_request_key`),
  UNIQUE KEY `uq_cap_impl_workspace_id` (`workspace_id`,`id`),
  KEY `ix_cap_impl_contract` (`workspace_id`,`contract_revision_id`,`lifecycle_status`),
  KEY `ix_cap_impl_adapter` (`workspace_id`,`runtime_adapter_revision_id`,`lifecycle_status`),
  KEY `fk_cap_impl_contract` (`contract_revision_id`),
  KEY `fk_cap_impl_runtime_adapter` (`runtime_adapter_revision_id`),
  CONSTRAINT `fk_cap_impl_contract` FOREIGN KEY (`contract_revision_id`) REFERENCES `capability_contract_revision` (`id`),
  CONSTRAINT `fk_cap_impl_runtime_adapter` FOREIGN KEY (`runtime_adapter_revision_id`) REFERENCES `runtime_adapter_revision` (`id`),
  CONSTRAINT `fk_cap_impl_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_impl_publication_request` CHECK (regexp_like(`publication_request_hash`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_cap_impl_source_kind` CHECK ((`source_kind` in (_utf8mb4'model_resource',_utf8mb4'model_service',_utf8mb4'plugin'))),
  CONSTRAINT `chk_cap_impl_status` CHECK ((`lifecycle_status` in (_utf8mb4'draft',_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked'))),
  CONSTRAINT `chk_cap_impl_target` CHECK ((`execution_target` in (_utf8mb4'browser',_utf8mb4'worker',_utf8mb4'provider')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_installation_operation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `catalog_entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `principal_type` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authentication_ref_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_version` int unsigned NOT NULL,
  `authorization_model_version` int unsigned NOT NULL,
  `effective_permissions` json NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `selected_route_policy_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `model_resource_import_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `installed_capability_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `failure` json DEFAULT NULL,
  `continuation_lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `continuation_lease_expires_at` datetime(3) DEFAULT NULL,
  `continuation_attempts` int unsigned NOT NULL DEFAULT '0',
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_install_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_install_request` (`workspace_id`,`idempotency_key`),
  KEY `ix_cap_install_catalog_entry` (`workspace_id`,`catalog_entry_id`,`lifecycle_status`),
  KEY `ix_cap_install_continuation` (`lifecycle_status`,`continuation_lease_expires_at`,`updated_at`,`id`),
  KEY `fk_cap_install_definition` (`workspace_id`,`installed_capability_definition_id`),
  CONSTRAINT `fk_cap_install_catalog_entry` FOREIGN KEY (`workspace_id`, `catalog_entry_id`) REFERENCES `capability_catalog_entry` (`workspace_id`, `id`),
  CONSTRAINT `fk_cap_install_definition` FOREIGN KEY (`workspace_id`, `installed_capability_definition_id`) REFERENCES `capability_definition` (`workspace_id`, `id`),
  CONSTRAINT `chk_cap_install_authority` CHECK ((((`principal_type` = _utf8mb4'human') and (`authentication_ref_type` = _utf8mb4'session') and (`authority_type` = _utf8mb4'human_membership')) or ((`principal_type` = _utf8mb4'service') and (`authentication_ref_type` = _utf8mb4'service_api_token') and (`authority_type` = _utf8mb4'service_grant')))),
  CONSTRAINT `chk_cap_install_completion` CHECK ((((`lifecycle_status` = _utf8mb4'installed') and (`installed_capability_definition_id` is not null) and (`failure` is null) and (`completed_at` is not null)) or ((`lifecycle_status` = _utf8mb4'failed') and (`installed_capability_definition_id` is null) and (`failure` is not null) and (`completed_at` is not null)) or ((`lifecycle_status` in (_utf8mb4'waiting_dependency',_utf8mb4'installing')) and (`installed_capability_definition_id` is null) and (`failure` is null) and (`completed_at` is null)))),
  CONSTRAINT `chk_cap_install_continuation` CHECK ((((`continuation_lease_token_hash` is null) and (`continuation_lease_expires_at` is null)) or (regexp_like(`continuation_lease_token_hash`,_utf8mb4'^[0-9a-f]{64}$') and (`continuation_lease_expires_at` is not null)))),
  CONSTRAINT `chk_cap_install_identity` CHECK ((regexp_like(`request_hash`,_utf8mb4'^sha256:[0-9a-f]{64}$') and regexp_like(`authentication_ref_hash`,_utf8mb4'^sha256:[0-9a-f]{64}$') and (`authority_version` >= 1) and (`authorization_model_version` >= 1) and (`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_cap_install_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'waiting_dependency',_utf8mb4'installing',_utf8mb4'installed',_utf8mb4'failed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `capability_run` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `invocation_kind` varchar(24) NOT NULL,
  `invocation_reference_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input` json NOT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `route_snapshot` json NOT NULL,
  `route_snapshot_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_deadline_at` datetime(3) NOT NULL,
  `contract_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `binding_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `current_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `accepted_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output` json DEFAULT NULL,
  `cancel_requested_at` datetime(3) DEFAULT NULL,
  `cancel_deadline_at` datetime(3) DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_capability_run_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_cap_run_node` (`node_run_id`),
  UNIQUE KEY `uq_cap_run_idempotency` (`workspace_id`,`invocation_kind`,`idempotency_key`),
  KEY `fk_cap_run_contract` (`contract_revision_id`),
  KEY `fk_cap_run_binding` (`binding_id`),
  KEY `fk_cap_run_impl` (`implementation_revision_id`),
  KEY `ix_cap_run_status` (`workspace_id`,`lifecycle_status`,`created_at`),
  KEY `fk_cap_run_current_attempt` (`current_attempt_id`),
  KEY `fk_cap_run_accepted_attempt` (`accepted_attempt_id`),
  KEY `ix_capability_run_reconcile` (`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_capability_run_cancel` (`lifecycle_status`,`cancel_deadline_at`,`updated_at`,`id`),
  CONSTRAINT `fk_cap_run_accepted_attempt` FOREIGN KEY (`accepted_attempt_id`) REFERENCES `capability_attempt` (`id`),
  CONSTRAINT `fk_cap_run_binding` FOREIGN KEY (`binding_id`) REFERENCES `capability_binding` (`id`),
  CONSTRAINT `fk_cap_run_contract` FOREIGN KEY (`contract_revision_id`) REFERENCES `capability_contract_revision` (`id`),
  CONSTRAINT `fk_cap_run_current_attempt` FOREIGN KEY (`current_attempt_id`) REFERENCES `capability_attempt` (`id`),
  CONSTRAINT `fk_cap_run_impl` FOREIGN KEY (`implementation_revision_id`) REFERENCES `capability_implementation_revision` (`id`),
  CONSTRAINT `fk_cap_run_node` FOREIGN KEY (`node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_cap_run_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_cap_run_accepted` CHECK ((((`lifecycle_status` = _utf8mb4'completed') and (`accepted_attempt_id` is not null)) or ((`lifecycle_status` <> _utf8mb4'completed') and (`accepted_attempt_id` is null)))),
  CONSTRAINT `chk_cap_run_input_digest` CHECK (regexp_like(`input_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_cap_run_invocation_identity` CHECK ((((`invocation_kind` = _utf8mb4'workflow') and (`node_run_id` is not null) and (`idempotency_key` is null) and (`request_hash` is null)) or ((`invocation_kind` in (_utf8mb4'user',_utf8mb4'agent',_utf8mb4'canvas')) and (`node_run_id` is null) and (`idempotency_key` is not null) and regexp_like(`request_hash`,_utf8mb4'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_cap_run_invocation_kind` CHECK ((`invocation_kind` in (_utf8mb4'user',_utf8mb4'agent',_utf8mb4'canvas',_utf8mb4'workflow'))),
  CONSTRAINT `chk_cap_run_route_digest` CHECK (regexp_like(`route_snapshot_hash`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_cap_run_status` CHECK ((`lifecycle_status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'completed',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_capability_run_cancel_facts` CHECK ((((`cancel_requested_at` is null) and (`cancel_deadline_at` is null)) or ((`cancel_requested_at` is not null) and (`cancel_deadline_at` is not null) and (`cancel_deadline_at` >= `cancel_requested_at`)))),
  CONSTRAINT `chk_capability_run_cancel_state` CHECK ((((`cancel_requested_at` is null) and (`lifecycle_status` <> _utf8mb4'cancelled')) or ((`cancel_requested_at` is not null) and (`lifecycle_status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'cancelled')))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `credential` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_kind` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authority_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `billing_identity_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `egress_identity_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `identity_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `identity_epoch` int unsigned NOT NULL,
  `material_generation` int unsigned NOT NULL,
  `active_secret_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credential_key` (`workspace_id`,`credential_key`),
  UNIQUE KEY `uq_credential_workspace_id` (`workspace_id`,`id`),
  KEY `fk_credential_created_by` (`created_by_principal_id`),
  KEY `ix_credential_endpoint_status` (`workspace_id`,`provider_endpoint_id`,`lifecycle_status`,`id`),
  KEY `fk_credential_active_secret_version` (`workspace_id`,`id`,`active_secret_version_id`),
  CONSTRAINT `fk_credential_active_secret_version` FOREIGN KEY (`workspace_id`, `id`, `active_secret_version_id`) REFERENCES `secret_version` (`workspace_id`, `credential_id`, `id`),
  CONSTRAINT `fk_credential_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_credential_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `chk_credential_identity` CHECK (((char_length(`credential_key`) between 1 and 160) and regexp_like(`authority_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`billing_identity_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`egress_identity_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`identity_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`identity_epoch` >= 1) and (`material_generation` >= 0))),
  CONSTRAINT `chk_credential_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'disabled',_ascii'revoked',_ascii'replaced'))),
  CONSTRAINT `chk_credential_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `font_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_id` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `family` varchar(240) NOT NULL,
  `upstream_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `descriptor_document` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_font_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_font_revision_content` (`workspace_id`,`source_id`,`external_id`,`content_digest`),
  UNIQUE KEY `uq_font_revision_idempotency` (`workspace_id`,`idempotency_key`),
  KEY `fk_font_revision_source_revision` (`workspace_id`,`source_id`,`source_revision_id`),
  KEY `fk_font_revision_created_by` (`created_by_principal_id`),
  KEY `ix_font_revision_catalog` (`workspace_id`,`created_at`,`id`),
  CONSTRAINT `fk_font_revision_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_font_revision_source_revision` FOREIGN KEY (`workspace_id`, `source_id`, `source_revision_id`) REFERENCES `resource_source_revision` (`workspace_id`, `source_id`, `id`),
  CONSTRAINT `chk_font_revision_identity` CHECK ((regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `font_revision_file` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `font_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `variant_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `format` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `weight` int unsigned NOT NULL,
  `style` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subset` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` int unsigned NOT NULL,
  PRIMARY KEY (`workspace_id`,`font_revision_id`,`variant_key`),
  UNIQUE KEY `uq_font_revision_file_artifact` (`workspace_id`,`artifact_id`),
  UNIQUE KEY `uq_font_revision_file_position` (`workspace_id`,`font_revision_id`,`position`),
  CONSTRAINT `fk_font_revision_file_artifact` FOREIGN KEY (`workspace_id`, `artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_font_revision_file_revision` FOREIGN KEY (`workspace_id`, `font_revision_id`) REFERENCES `font_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_font_revision_file` CHECK (((`format` in (_ascii'ttf',_ascii'otf')) and (`weight` between 1 and 1000) and (`style` in (_ascii'normal',_ascii'italic')) and (`position` < 256)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `human_principal` (
  `principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `auth_subject_id` varchar(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`principal_id`),
  UNIQUE KEY `uq_human_principal_auth_subject` (`auth_subject_id`),
  CONSTRAINT `fk_human_principal` FOREIGN KEY (`principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_human_auth_subject` CHECK ((char_length(`auth_subject_id`) between 1 and 240))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `inbox_receipt` (
  `consumer_name` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `message_type` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `aggregate_type` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_version` int unsigned NOT NULL,
  `expected_generation` int unsigned NOT NULL,
  `effect_outcome` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `received_at` datetime(3) NOT NULL,
  `processed_at` datetime(3) NOT NULL,
  PRIMARY KEY (`consumer_name`,`event_id`),
  KEY `ix_inbox_workspace` (`workspace_id`,`processed_at`,`event_id`),
  KEY `ix_inbox_aggregate` (`consumer_name`,`aggregate_type`,`aggregate_id`,`aggregate_version`),
  CONSTRAINT `fk_inbox_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_inbox_aggregate_version` CHECK ((`aggregate_version` >= 1)),
  CONSTRAINT `chk_inbox_effect_outcome` CHECK ((`effect_outcome` in (_ascii'applied',_ascii'noop'))),
  CONSTRAINT `chk_inbox_generation` CHECK ((`expected_generation` >= 1)),
  CONSTRAINT `chk_inbox_schema_version` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_inbox_timestamps` CHECK ((`processed_at` >= `received_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `instance_administrator` (
  `principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`principal_id`),
  KEY `ix_instance_administrator_status` (`status`,`principal_id`),
  CONSTRAINT `fk_instance_administrator_human` FOREIGN KEY (`principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `chk_instance_administrator_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'revoked'))),
  CONSTRAINT `chk_instance_administrator_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `instance_policy_binding` (
  `singleton_id` tinyint unsigned NOT NULL,
  `active_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`singleton_id`),
  KEY `fk_instance_policy_binding_revision` (`active_revision_id`),
  KEY `fk_instance_policy_binding_updated_by` (`updated_by_principal_id`),
  CONSTRAINT `fk_instance_policy_binding_revision` FOREIGN KEY (`active_revision_id`) REFERENCES `instance_policy_revision` (`id`),
  CONSTRAINT `fk_instance_policy_binding_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_instance_policy_binding_singleton` CHECK (((`singleton_id` = 1) and (`version` >= 1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `instance_policy_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `policy_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supersedes_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_instance_policy_revision` (`revision`),
  UNIQUE KEY `uq_instance_policy_digest` (`canonical_digest`),
  KEY `fk_instance_policy_supersedes` (`supersedes_revision_id`),
  KEY `fk_instance_policy_created_by` (`created_by_principal_id`),
  KEY `fk_instance_policy_published_by` (`published_by_principal_id`),
  CONSTRAINT `fk_instance_policy_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_instance_policy_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_instance_policy_supersedes` FOREIGN KEY (`supersedes_revision_id`) REFERENCES `instance_policy_revision` (`id`),
  CONSTRAINT `chk_instance_policy_document` CHECK (((`revision` >= 1) and (`schema_version` >= 1) and (json_type(`policy_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_instance_policy_lifecycle` CHECK ((`lifecycle_status` in (_ascii'published',_ascii'deprecated',_ascii'revoked'))),
  CONSTRAINT `chk_instance_policy_time` CHECK ((`published_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `instance_runtime_state` (
  `instance_id` varchar(120) NOT NULL,
  `state` varchar(24) NOT NULL,
  `execution_generation` int unsigned NOT NULL DEFAULT '1',
  `state_version` int unsigned NOT NULL DEFAULT '1',
  `reason` varchar(500) NOT NULL,
  `deadline` datetime(3) DEFAULT NULL,
  `changed_by` varchar(120) NOT NULL,
  `changed_at` datetime(3) NOT NULL,
  PRIMARY KEY (`instance_id`),
  CONSTRAINT `chk_instance_runtime_state` CHECK ((`state` in (_utf8mb4'ACTIVE',_utf8mb4'DRAINING',_utf8mb4'MAINTENANCE',_utf8mb4'RESTORING',_utf8mb4'VERIFYING',_utf8mb4'READ_ONLY')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `instance_setup_token` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_prefix` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hash_version` smallint unsigned NOT NULL,
  `binding_mode` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `binding_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expires_at` datetime(3) NOT NULL,
  `used_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_instance_setup_token_hash` (`token_hash`),
  KEY `ix_instance_setup_token_prefix` (`token_prefix`,`expires_at`,`id`),
  CONSTRAINT `chk_instance_setup_token_binding` CHECK ((((`binding_mode` = _ascii'unbound') and (`binding_hash` is null)) or ((`binding_mode` in (_ascii'auth_subject',_ascii'verified_email_hash')) and regexp_like(`binding_hash`,_ascii'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_instance_setup_token_hash` CHECK ((regexp_like(`token_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`hash_version` >= 1))),
  CONSTRAINT `chk_instance_setup_token_time` CHECK (((`expires_at` > `created_at`) and ((`used_at` is null) or (`used_at` >= `created_at`)) and ((`revoked_at` is null) or (`revoked_at` >= `created_at`)) and ((`used_at` is null) or (`revoked_at` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `invitation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `target_email_normalized` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `target_email_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `organization_role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workspace_role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `token_prefix` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hash_version` smallint unsigned NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `accepted_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `revoked_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `invited_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invitation_token_hash` (`token_hash`),
  KEY `fk_invitation_workspace` (`organization_id`,`workspace_id`),
  KEY `fk_invitation_target_human` (`target_principal_id`),
  KEY `fk_invitation_inviter_human` (`invited_by_principal_id`),
  KEY `ix_invitation_target` (`organization_id`,`target_email_hash`,`status`,`expires_at`,`id`),
  KEY `ix_invitation_prefix` (`token_prefix`,`status`,`expires_at`,`id`),
  CONSTRAINT `fk_invitation_inviter_human` FOREIGN KEY (`invited_by_principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `fk_invitation_organization` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`),
  CONSTRAINT `fk_invitation_target_human` FOREIGN KEY (`target_principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `fk_invitation_workspace` FOREIGN KEY (`organization_id`, `workspace_id`) REFERENCES `workspace` (`organization_id`, `id`),
  CONSTRAINT `chk_invitation_email` CHECK (((char_length(`target_email_normalized`) between 3 and 320) and regexp_like(`target_email_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_invitation_roles` CHECK ((((`organization_role` is null) or (`organization_role` in (_ascii'owner',_ascii'admin',_ascii'member'))) and ((`workspace_role` is null) or (`workspace_role` in (_ascii'owner',_ascii'admin',_ascii'editor',_ascii'reviewer',_ascii'viewer'))) and ((`organization_role` is not null) or (`workspace_role` is not null)) and ((`workspace_role` is null) or (`workspace_id` is not null)))),
  CONSTRAINT `chk_invitation_state` CHECK (((`expires_at` > `created_at`) and (`version` >= 1) and (`updated_at` >= `created_at`) and (((`status` = _ascii'pending') and (`accepted_at` is null) and (`revoked_at` is null) and (`revoked_reason_code` is null)) or ((`status` = _ascii'accepted') and (`accepted_at` is not null) and (`accepted_at` >= `created_at`) and (`revoked_at` is null) and (`revoked_reason_code` is null)) or ((`status` = _ascii'revoked') and (`accepted_at` is null) and (`revoked_at` is not null) and (`revoked_at` >= `created_at`) and (`revoked_reason_code` is not null) and (char_length(`revoked_reason_code`) between 1 and 120))))),
  CONSTRAINT `chk_invitation_status` CHECK ((`status` in (_ascii'pending',_ascii'accepted',_ascii'revoked'))),
  CONSTRAINT `chk_invitation_token` CHECK ((regexp_like(`token_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`hash_version` >= 1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_deployment` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_model_record_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `model_profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `deployment_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_model_id` varchar(512) NOT NULL,
  `generation` int unsigned NOT NULL DEFAULT '1',
  `supersedes_model_deployment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `deployment_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_deployment_key` (`workspace_id`,`deployment_key`),
  UNIQUE KEY `uq_model_deployment_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_model_deployment_provider_generation` (`provider_endpoint_id`,`provider_model_id`,`generation`),
  KEY `fk_model_deployment_profile` (`workspace_id`,`model_profile_revision_id`),
  KEY `fk_model_deployment_created_by` (`created_by_principal_id`),
  KEY `ix_model_deployment_status` (`workspace_id`,`provider_endpoint_id`,`lifecycle_status`,`id`),
  KEY `ix_model_deployment_supersedes` (`workspace_id`,`supersedes_model_deployment_id`),
  KEY `ix_model_deployment_provider_model` (`workspace_id`,`provider_model_record_id`,`lifecycle_status`,`generation`),
  CONSTRAINT `fk_model_deployment_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_model_deployment_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_deployment_profile` FOREIGN KEY (`workspace_id`, `model_profile_revision_id`) REFERENCES `model_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_deployment_provider_model` FOREIGN KEY (`workspace_id`, `provider_model_record_id`) REFERENCES `provider_model` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_deployment_supersedes` FOREIGN KEY (`workspace_id`, `supersedes_model_deployment_id`) REFERENCES `model_deployment` (`workspace_id`, `id`),
  CONSTRAINT `chk_model_deployment_generation` CHECK (((`generation` >= 1) and ((`supersedes_model_deployment_id` is null) or (`supersedes_model_deployment_id` <> `id`)))),
  CONSTRAINT `chk_model_deployment_identity` CHECK (((char_length(`deployment_key`) between 1 and 160) and (char_length(`provider_model_id`) between 1 and 512) and regexp_like(`deployment_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_model_deployment_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'superseded',_ascii'draining',_ascii'disabled',_ascii'revoked'))),
  CONSTRAINT `chk_model_deployment_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_profile_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canonical_model_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `profile_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `profile_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_profile_revision` (`workspace_id`,`profile_key`,`revision`),
  UNIQUE KEY `uq_model_profile_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_model_profile_workspace_id` (`workspace_id`,`id`),
  KEY `fk_model_profile_created_by` (`created_by_principal_id`),
  KEY `fk_model_profile_published_by` (`published_by_principal_id`),
  KEY `ix_model_profile_canonical` (`workspace_id`,`canonical_model_id`,`lifecycle_status`,`revision`),
  CONSTRAINT `fk_model_profile_canonical` FOREIGN KEY (`workspace_id`, `canonical_model_id`) REFERENCES `canonical_model` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_profile_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_model_profile_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_model_profile_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_model_profile_document` CHECK (((`revision` >= 1) and (`schema_version` >= 1) and (json_type(`profile_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_model_profile_lifecycle` CHECK ((`lifecycle_status` in (_ascii'published',_ascii'deprecated',_ascii'revoked'))),
  CONSTRAINT `chk_model_profile_time` CHECK ((`published_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_reference_snapshot` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` bigint unsigned NOT NULL AUTO_INCREMENT,
  `schema_version` smallint unsigned NOT NULL,
  `source_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_revision` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference_document` json NOT NULL,
  `fetched_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_reference_snapshot_revision` (`revision`),
  UNIQUE KEY `uq_model_reference_snapshot_source_digest` (`source_digest`),
  UNIQUE KEY `uq_model_reference_snapshot_source_revision` (`source_revision`),
  KEY `fk_model_reference_snapshot_principal` (`created_by_principal_id`),
  CONSTRAINT `fk_model_reference_snapshot_principal` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_model_reference_snapshot_document` CHECK (((`schema_version` = 1) and (`source_kind` = _ascii'models_dev') and (char_length(`source_revision`) between 1 and 160) and regexp_like(`source_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (json_type(`reference_document`) = _utf8mb4'OBJECT') and (`published_at` >= `fetched_at`) and (`created_at` >= `published_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `current_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `create_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `create_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_resource_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_model_resource_key` (`workspace_id`,`resource_key`),
  UNIQUE KEY `uq_model_resource_create_request` (`workspace_id`,`create_request_key`),
  KEY `ix_model_resource_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_model_resource_current_revision` (`workspace_id`,`id`,`current_revision_id`),
  CONSTRAINT `fk_model_resource_current_revision` FOREIGN KEY (`workspace_id`, `id`, `current_revision_id`) REFERENCES `model_resource_revision` (`workspace_id`, `model_resource_id`, `id`),
  CONSTRAINT `fk_model_resource_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_model_resource_archived` CHECK ((((`lifecycle_status` = _ascii'archived') and (`archived_at` is not null)) or ((`lifecycle_status` = _ascii'active') and (`archived_at` is null)))),
  CONSTRAINT `chk_model_resource_identity` CHECK ((regexp_like(`resource_key`,_ascii'^[a-z0-9]+([._-][a-z0-9]+)+$') and regexp_like(`create_request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_model_resource_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource_catalog_entry` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asset_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document` json NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_resource_catalog_entry_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_model_resource_catalog_entry_asset` (`workspace_id`,`asset_key`),
  UNIQUE KEY `uq_model_resource_catalog_entry_revision` (`workspace_id`,`resource_key`,`revision`),
  KEY `ix_model_resource_catalog_entry_list` (`workspace_id`,`lifecycle_status`,`resource_key`),
  CONSTRAINT `fk_model_resource_catalog_entry_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_model_resource_catalog_entry_identity` CHECK (((`revision` >= 1) and regexp_like(`canonical_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$') and regexp_like(`resource_key`,_utf8mb4'^[a-z0-9]+([._-][a-z0-9]+)+$'))),
  CONSTRAINT `chk_model_resource_catalog_entry_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'retired')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource_import` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_kind` varchar(24) NOT NULL,
  `source` json NOT NULL,
  `catalog_entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expected_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expected_byte_size` varchar(20) DEFAULT NULL,
  `downloaded_bytes` bigint unsigned NOT NULL DEFAULT '0',
  `cancel_requested_at` datetime(3) DEFAULT NULL,
  `upload_session_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `suggested_key` varchar(160) DEFAULT NULL,
  `suggested_display_name` varchar(160) DEFAULT NULL,
  `detected_format` varchar(40) DEFAULT NULL,
  `detected_license` json DEFAULT NULL,
  `native_interface` json DEFAULT NULL,
  `compatible_adapters` json NOT NULL,
  `required_user_inputs` json NOT NULL,
  `failure` json DEFAULT NULL,
  `processing_lease_generation` int unsigned NOT NULL DEFAULT '0',
  `processing_lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `processing_lease_expires_at` datetime(3) DEFAULT NULL,
  `processing_attempts` int unsigned NOT NULL DEFAULT '0',
  `published_model_resource_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_resource_import_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_model_resource_import_request` (`workspace_id`,`idempotency_key`),
  UNIQUE KEY `uq_model_resource_import_upload` (`workspace_id`,`upload_session_id`),
  KEY `ix_model_resource_import_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_model_resource_import_work` (`lifecycle_status`,`processing_lease_expires_at`,`updated_at`,`id`),
  KEY `fk_model_resource_import_catalog_entry` (`workspace_id`,`catalog_entry_id`),
  KEY `fk_model_resource_import_published_revision` (`workspace_id`,`published_model_resource_revision_id`),
  CONSTRAINT `fk_model_resource_import_catalog_entry` FOREIGN KEY (`workspace_id`, `catalog_entry_id`) REFERENCES `model_resource_catalog_entry` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_resource_import_published_revision` FOREIGN KEY (`workspace_id`, `published_model_resource_revision_id`) REFERENCES `model_resource_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_resource_import_upload` FOREIGN KEY (`workspace_id`, `upload_session_id`) REFERENCES `upload_session` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_resource_import_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_model_resource_import_expected` CHECK ((((`catalog_entry_id` is null) and (`expected_sha256` is null) and (`expected_byte_size` is null)) or ((`catalog_entry_id` is not null) and (`source_kind` = _utf8mb4'url') and regexp_like(`expected_sha256`,_ascii'^[0-9a-f]{64}$') and ((`expected_byte_size` is null) or regexp_like(`expected_byte_size`,_utf8mb4'^[1-9][0-9]{0,19}$'))))),
  CONSTRAINT `chk_model_resource_import_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'waiting_upload',_utf8mb4'fetching',_utf8mb4'analyzing',_utf8mb4'needs_input',_utf8mb4'ready',_utf8mb4'published',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_model_resource_import_source` CHECK ((`source_kind` in (_utf8mb4'url',_utf8mb4'upload'))),
  CONSTRAINT `chk_model_resource_import_version` CHECK (((`version` >= 1) and regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource_import_file` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_resource_import_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `path` varchar(700) NOT NULL,
  `stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `media_type` varchar(160) NOT NULL,
  `byte_size` varchar(20) NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_metadata` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`model_resource_import_id`,`path`),
  UNIQUE KEY `uq_model_resource_import_file_object` (`workspace_id`,`stored_object_id`),
  CONSTRAINT `fk_model_resource_import_file_import` FOREIGN KEY (`workspace_id`, `model_resource_import_id`) REFERENCES `model_resource_import` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_resource_import_file_object` FOREIGN KEY (`workspace_id`, `stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `chk_model_resource_import_file_sha` CHECK (regexp_like(`sha256`,_ascii'^[0-9a-f]{64}$')),
  CONSTRAINT `chk_model_resource_import_file_size` CHECK (regexp_like(`byte_size`,_ascii'^(0|[1-9][0-9]{0,19})$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_resource_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `display_name` varchar(160) NOT NULL,
  `description` varchar(1000) DEFAULT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `manifest` json NOT NULL,
  `publication_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_model_resource_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_model_resource_revision_resource_id` (`workspace_id`,`model_resource_id`,`id`),
  UNIQUE KEY `uq_model_resource_revision_number` (`workspace_id`,`model_resource_id`,`revision`),
  UNIQUE KEY `uq_model_resource_publication_request` (`workspace_id`,`publication_request_key`),
  CONSTRAINT `fk_model_resource_revision_resource` FOREIGN KEY (`workspace_id`, `model_resource_id`) REFERENCES `model_resource` (`workspace_id`, `id`),
  CONSTRAINT `chk_model_resource_revision_identity` CHECK (((`revision` >= 1) and (`schema_version` = 1) and (char_length(`display_name`) between 1 and 160) and regexp_like(`canonical_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$') and regexp_like(`publication_request_hash`,_utf8mb4'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_model_resource_revision_lifecycle` CHECK ((`lifecycle_status` in (_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_resource_revision_file` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_resource_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `path` varchar(700) NOT NULL,
  `stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` varchar(80) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`model_resource_revision_id`,`path`),
  KEY `ix_model_resource_revision_file_object` (`workspace_id`,`stored_object_id`),
  CONSTRAINT `fk_model_resource_revision_file_object` FOREIGN KEY (`workspace_id`, `stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `fk_model_resource_revision_file_revision` FOREIGN KEY (`workspace_id`, `model_resource_revision_id`) REFERENCES `model_resource_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `node_run` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `node_key` varchar(100) NOT NULL,
  `scope_key` varchar(160) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `waiting_reason` varchar(32) DEFAULT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `activation_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `activation_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `input` json DEFAULT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output` json DEFAULT NULL,
  `output_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `error` json DEFAULT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_node_run_scope` (`workflow_run_id`,`node_key`,`scope_key`),
  KEY `ix_node_run_status` (`workspace_id`,`workflow_run_id`,`lifecycle_status`),
  KEY `ix_node_run_activation` (`workflow_run_id`,`activated_at`,`lifecycle_status`,`node_key`,`scope_key`),
  CONSTRAINT `fk_node_run_workflow` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_node_run_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_node_run_activation_fact` CHECK ((((`activated_at` is null) and (`activation_reason_code` is null) and (`activation_digest` is null)) or ((`activated_at` is not null) and (`activation_reason_code` is not null) and (`activation_digest` is not null)))),
  CONSTRAINT `chk_node_run_activation_reason` CHECK (((`activation_reason_code` is null) or regexp_like(`activation_reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$'))),
  CONSTRAINT `chk_node_run_input_digest` CHECK (((`input_digest` is null) or (`input` is not null))),
  CONSTRAINT `chk_node_run_kind` CHECK ((`kind` in (_utf8mb4'invoke',_utf8mb4'switch',_utf8mb4'map',_utf8mb4'approval'))),
  CONSTRAINT `chk_node_run_output_digest` CHECK (((`output_digest` is null) or (`output` is not null))),
  CONSTRAINT `chk_node_run_status` CHECK ((`lifecycle_status` in (_utf8mb4'pending',_utf8mb4'running',_utf8mb4'waiting',_utf8mb4'completed',_utf8mb4'failed',_utf8mb4'skipped',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_node_run_terminal_reason` CHECK (((`terminal_reason_code` is null) or regexp_like(`terminal_reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$'))),
  CONSTRAINT `chk_node_run_waiting` CHECK ((((`lifecycle_status` = _utf8mb4'waiting') and (`waiting_reason` = _utf8mb4'approval')) or ((`lifecycle_status` <> _utf8mb4'waiting') and (`waiting_reason` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `organization` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `slug` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(160) NOT NULL,
  `status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_organization_slug` (`slug`),
  CONSTRAINT `chk_organization_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'archived',_ascii'setup_required'))),
  CONSTRAINT `chk_organization_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `organization_membership` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_organization_membership_principal` (`organization_id`,`principal_id`),
  UNIQUE KEY `uq_organization_membership_scope_id` (`organization_id`,`id`),
  KEY `fk_organization_membership_human` (`principal_id`),
  KEY `ix_organization_membership_owner` (`organization_id`,`status`,`role`,`id`),
  CONSTRAINT `fk_organization_membership_human` FOREIGN KEY (`principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `fk_organization_membership_organization` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`),
  CONSTRAINT `chk_organization_membership_role` CHECK ((`role` in (_ascii'owner',_ascii'admin',_ascii'member'))),
  CONSTRAINT `chk_organization_membership_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'revoked'))),
  CONSTRAINT `chk_organization_membership_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `outbox_event` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `message_type` varchar(120) NOT NULL,
  `schema_version` smallint unsigned NOT NULL DEFAULT '1',
  `aggregate_type` varchar(80) NOT NULL,
  `aggregate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_version` int unsigned NOT NULL,
  `payload` json NOT NULL,
  `status` varchar(24) NOT NULL,
  `available_at` datetime(3) NOT NULL,
  `lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_expires_at` datetime(3) DEFAULT NULL,
  `publish_attempts` int unsigned NOT NULL DEFAULT '0',
  `published_at` datetime(3) DEFAULT NULL,
  `last_error_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `quarantined_at` datetime(3) DEFAULT NULL,
  `superseded_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outbox_workspace_id` (`workspace_id`,`id`),
  KEY `ix_outbox_relay` (`status`,`available_at`,`lease_expires_at`),
  KEY `ix_outbox_aggregate` (`workspace_id`,`aggregate_type`,`aggregate_id`),
  CONSTRAINT `fk_outbox_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_outbox_aggregate_version` CHECK ((`aggregate_version` >= 1)),
  CONSTRAINT `chk_outbox_schema_version` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_outbox_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'leased',_utf8mb4'published',_utf8mb4'quarantined',_utf8mb4'superseded'))),
  CONSTRAINT `chk_outbox_terminal_disposition` CHECK ((((`status` = _utf8mb4'quarantined') and (`last_error_code` is not null) and (`quarantined_at` is not null) and (`superseded_at` is null) and (`lease_token_hash` is null) and (`lease_expires_at` is null)) or ((`status` = _utf8mb4'superseded') and (`last_error_code` is not null) and (`quarantined_at` is null) and (`superseded_at` is not null) and (`lease_token_hash` is null) and (`lease_expires_at` is null)) or ((`status` not in (_utf8mb4'quarantined',_utf8mb4'superseded')) and (`last_error_code` is null) and (`quarantined_at` is null) and (`superseded_at` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pricing_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `model_deployment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pricing_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pricing_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `verified_at` datetime(3) NOT NULL,
  `effective_at` datetime(3) NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pricing_revision_number` (`workspace_id`,`pricing_key`,`revision`),
  UNIQUE KEY `uq_pricing_revision_workspace_id` (`workspace_id`,`id`),
  KEY `fk_pricing_revision_model` (`workspace_id`,`model_deployment_id`),
  KEY `fk_pricing_revision_created_by` (`created_by_principal_id`),
  KEY `fk_pricing_revision_published_by` (`published_by_principal_id`),
  KEY `ix_pricing_revision_scope` (`workspace_id`,`provider_endpoint_id`,`model_deployment_id`,`lifecycle_status`,`effective_at`,`id`),
  CONSTRAINT `fk_pricing_revision_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_pricing_revision_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_pricing_revision_model` FOREIGN KEY (`workspace_id`, `model_deployment_id`) REFERENCES `model_deployment` (`workspace_id`, `id`),
  CONSTRAINT `fk_pricing_revision_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_pricing_revision_document` CHECK (((`revision` >= 1) and (`schema_version` >= 1) and regexp_like(`currency_code`,_ascii'^[A-Z]{3}$') and (json_type(`pricing_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_pricing_revision_lifecycle` CHECK (((`lifecycle_status` in (_ascii'published',_ascii'deprecated',_ascii'revoked')) and (`source_kind` in (_ascii'provider_documentation',_ascii'provider_api',_ascii'manual',_ascii'contract',_ascii'unverified')))),
  CONSTRAINT `chk_pricing_revision_time` CHECK (((`verified_at` >= `created_at`) and (`published_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `principal` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `principal_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_principal_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'revoked'))),
  CONSTRAINT `chk_principal_type` CHECK ((`principal_type` in (_ascii'human',_ascii'service'))),
  CONSTRAINT `chk_principal_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_endpoint` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `endpoint_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_kind` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `preset_kind` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `base_url` varchar(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `canonical_origin` varchar(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `base_url_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `region_code` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `network_policy` json NOT NULL,
  `data_policy` json NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `validated_at` datetime(3) DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_endpoint_key` (`workspace_id`,`endpoint_key`),
  UNIQUE KEY `uq_provider_endpoint_workspace_id` (`workspace_id`,`id`),
  KEY `fk_provider_endpoint_created_by` (`created_by_principal_id`),
  KEY `ix_provider_endpoint_status` (`workspace_id`,`lifecycle_status`,`adapter_kind`,`id`),
  CONSTRAINT `fk_provider_endpoint_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_provider_endpoint_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_endpoint_adapter` CHECK (((`adapter_kind` in (_ascii'openai_native',_ascii'openrouter_native',_ascii'openai_compatible',_ascii'gemini_native',_ascii'anthropic_native',_ascii'resource_catalog')) and (`preset_kind` in (_ascii'none',_ascii'openai',_ascii'anthropic',_ascii'openrouter',_ascii'xai',_ascii'gemini',_ascii'newapi',_ascii'tokenhub')))),
  CONSTRAINT `chk_provider_endpoint_identity` CHECK (((char_length(`endpoint_key`) between 1 and 160) and (char_length(`base_url`) between 1 and 2048) and (char_length(`canonical_origin`) between 1 and 512) and regexp_like(`base_url_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (json_type(`network_policy`) = _utf8mb4'OBJECT') and (json_type(`data_policy`) = _utf8mb4'OBJECT'))),
  CONSTRAINT `chk_provider_endpoint_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'disabled',_ascii'draining',_ascii'revoked'))),
  CONSTRAINT `chk_provider_endpoint_validation` CHECK ((((`validation_status` = _ascii'pending') and (`validation_digest` is null) and (`validated_at` is null)) or ((`validation_status` in (_ascii'passed',_ascii'failed')) and regexp_like(`validation_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`validated_at` is not null)))),
  CONSTRAINT `chk_provider_endpoint_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_invocation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `implementation_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `api_surface` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_identity_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_identity_epoch` int unsigned NOT NULL,
  `pinned_secret_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `model_deployment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pricing_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `budget_reservation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `route_candidate_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_scope_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stable_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_fingerprint` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parameter_resolution_snapshot` json DEFAULT NULL,
  `parameter_resolution_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `prepared_request_snapshot` json DEFAULT NULL,
  `prepared_request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `provider_request_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `remote_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `side_effect_state` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `query_mode` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `not_found_is_authoritative` tinyint(1) NOT NULL,
  `work_state` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reconcile_lease_generation` int unsigned NOT NULL DEFAULT '0',
  `reconcile_execution_generation` int unsigned DEFAULT NULL,
  `reconcile_lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `reconcile_lease_expires_at` datetime(3) DEFAULT NULL,
  `next_reconcile_at` datetime(3) DEFAULT NULL,
  `submission_attempts` smallint unsigned NOT NULL DEFAULT '0',
  `query_attempts` smallint unsigned NOT NULL DEFAULT '0',
  `cancel_attempts` smallint unsigned NOT NULL DEFAULT '0',
  `version` int unsigned NOT NULL,
  `prepared_at` datetime(3) NOT NULL,
  `submission_started_at` datetime(3) DEFAULT NULL,
  `acknowledged_at` datetime(3) DEFAULT NULL,
  `last_observed_at` datetime(3) DEFAULT NULL,
  `terminal_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_invocation_attempt` (`capability_attempt_id`),
  UNIQUE KEY `uq_provider_invocation_stable_request` (`request_scope_digest`,`stable_request_key`),
  UNIQUE KEY `uq_provider_invocation_usage_scope` (`workspace_id`,`capability_attempt_id`,`id`),
  KEY `fk_provider_invocation_implementation` (`implementation_revision_id`),
  KEY `ix_provider_invocation_reconcile` (`work_state`,`next_reconcile_at`,`id`),
  KEY `ix_provider_invocation_reconcile_lease` (`work_state`,`reconcile_lease_expires_at`,`id`),
  KEY `ix_provider_invocation_work` (`work_state`,`updated_at`,`id`),
  KEY `ix_provider_invocation_provider_request` (`request_scope_digest`,`provider_request_id`),
  KEY `ix_provider_invocation_workspace` (`workspace_id`,`created_at`,`id`),
  KEY `fk_provider_invocation_secret_version` (`workspace_id`,`credential_identity_id`,`pinned_secret_version_id`),
  KEY `fk_provider_invocation_budget_reservation` (`workspace_id`,`budget_reservation_id`),
  CONSTRAINT `fk_provider_invocation_attempt` FOREIGN KEY (`capability_attempt_id`) REFERENCES `capability_attempt` (`id`),
  CONSTRAINT `fk_provider_invocation_budget_reservation` FOREIGN KEY (`workspace_id`, `budget_reservation_id`) REFERENCES `budget_reservation` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_invocation_implementation` FOREIGN KEY (`implementation_revision_id`) REFERENCES `capability_implementation_revision` (`id`),
  CONSTRAINT `fk_provider_invocation_secret_version` FOREIGN KEY (`workspace_id`, `credential_identity_id`, `pinned_secret_version_id`) REFERENCES `secret_version` (`workspace_id`, `credential_id`, `id`),
  CONSTRAINT `fk_provider_invocation_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_invocation_identity` CHECK (((`credential_identity_epoch` >= 1) and (char_length(`provider_key`) between 1 and 80) and (char_length(`api_surface`) between 1 and 80) and (char_length(`stable_request_key`) between 1 and 160) and (`route_candidate_digest` like _ascii'sha256:%') and (`request_scope_digest` like _ascii'sha256:%') and (`request_fingerprint` like _ascii'sha256:%'))),
  CONSTRAINT `chk_provider_invocation_lease` CHECK ((((`work_state` in (_ascii'submit_leased',_ascii'query_leased')) and (`reconcile_lease_generation` >= 1) and (`reconcile_execution_generation` is not null) and (`reconcile_execution_generation` >= 1) and (`reconcile_lease_token_hash` is not null) and (`reconcile_lease_expires_at` is not null) and (`next_reconcile_at` is null)) or ((`work_state` not in (_ascii'submit_leased',_ascii'query_leased')) and (`reconcile_execution_generation` is null) and (`reconcile_lease_token_hash` is null) and (`reconcile_lease_expires_at` is null)))),
  CONSTRAINT `chk_provider_invocation_not_found_authority` CHECK (((`not_found_is_authoritative` in (false,true)) and ((`query_mode` <> _ascii'none') or (`not_found_is_authoritative` = false)) and ((`remote_status` <> _ascii'not_found') or (`not_found_is_authoritative` = true)))),
  CONSTRAINT `chk_provider_invocation_parameter_resolution_snapshot` CHECK ((((`parameter_resolution_snapshot` is null) and (`parameter_resolution_digest` is null)) or ((`parameter_resolution_snapshot` is not null) and (`parameter_resolution_digest` is not null) and regexp_like(`parameter_resolution_digest`,_ascii'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_provider_invocation_prepared_request_snapshot` CHECK ((((`prepared_request_snapshot` is null) and (`prepared_request_digest` is null)) or ((`prepared_request_snapshot` is not null) and (`prepared_request_digest` is not null) and regexp_like(`prepared_request_digest`,_ascii'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_provider_invocation_query_identity` CHECK (((`work_state` not in (_ascii'query_pending',_ascii'query_leased')) or (`query_mode` = _ascii'client_request_id') or ((`query_mode` = _ascii'provider_request_id') and (`provider_request_id` is not null)))),
  CONSTRAINT `chk_provider_invocation_query_mode` CHECK ((`query_mode` in (_ascii'none',_ascii'client_request_id',_ascii'provider_request_id'))),
  CONSTRAINT `chk_provider_invocation_remote_effect` CHECK ((((`remote_status` = _ascii'prepared') and (`side_effect_state` = _ascii'not_started') and (`work_state` in (_ascii'submit_pending',_ascii'submit_leased')) and (`submission_started_at` is null) and (`acknowledged_at` is null)) or ((`remote_status` = _ascii'submitting') and (`side_effect_state` = _ascii'unknown') and (`work_state` in (_ascii'submit_leased',_ascii'query_pending',_ascii'query_leased')) and (`submission_started_at` is not null)) or ((`remote_status` in (_ascii'accepted',_ascii'running')) and (`side_effect_state` = _ascii'started') and (`work_state` in (_ascii'waiting_remote',_ascii'query_pending',_ascii'query_leased')) and (`submission_started_at` is not null) and (`acknowledged_at` is not null)) or ((`remote_status` = _ascii'unknown') and (`side_effect_state` = _ascii'unknown') and (`work_state` in (_ascii'query_pending',_ascii'query_leased',_ascii'manual')) and (`submission_started_at` is not null)) or ((`remote_status` = _ascii'succeeded') and (`side_effect_state` = _ascii'committed') and (`work_state` = _ascii'terminal')) or ((`remote_status` in (_ascii'failed',_ascii'cancelled')) and (`work_state` = _ascii'terminal')) or ((`remote_status` = _ascii'not_found') and (`side_effect_state` = _ascii'not_started') and (`work_state` = _ascii'terminal')))),
  CONSTRAINT `chk_provider_invocation_remote_status` CHECK ((`remote_status` in (_ascii'prepared',_ascii'submitting',_ascii'accepted',_ascii'running',_ascii'succeeded',_ascii'failed',_ascii'cancelled',_ascii'not_found',_ascii'unknown'))),
  CONSTRAINT `chk_provider_invocation_schedule` CHECK ((((`work_state` in (_ascii'submit_pending',_ascii'query_pending')) and (`next_reconcile_at` is not null)) or ((`work_state` not in (_ascii'submit_pending',_ascii'query_pending')) and (`next_reconcile_at` is null)))),
  CONSTRAINT `chk_provider_invocation_side_effect` CHECK ((`side_effect_state` in (_ascii'not_started',_ascii'started',_ascii'committed',_ascii'unknown'))),
  CONSTRAINT `chk_provider_invocation_terminal` CHECK ((((`remote_status` in (_ascii'succeeded',_ascii'failed',_ascii'cancelled',_ascii'not_found')) and (`terminal_at` is not null) and (`work_state` = _ascii'terminal')) or ((`remote_status` not in (_ascii'succeeded',_ascii'failed',_ascii'cancelled',_ascii'not_found')) and (`terminal_at` is null) and (`work_state` <> _ascii'terminal')))),
  CONSTRAINT `chk_provider_invocation_timestamps` CHECK (((`prepared_at` >= `created_at`) and (`updated_at` >= `created_at`) and ((`submission_started_at` is null) or (`submission_started_at` >= `prepared_at`)) and ((`acknowledged_at` is null) or ((`submission_started_at` is not null) and (`acknowledged_at` >= `submission_started_at`))) and ((`last_observed_at` is null) or (`last_observed_at` >= `prepared_at`)) and ((`terminal_at` is null) or ((`terminal_at` >= `prepared_at`) and ((`last_observed_at` is null) or (`terminal_at` >= `last_observed_at`)))))),
  CONSTRAINT `chk_provider_invocation_version` CHECK (((`version` >= 1) and (`submission_attempts` <= 65535) and (`query_attempts` <= 65535) and (`cancel_attempts` <= 65535))),
  CONSTRAINT `chk_provider_invocation_work_reconcile` CHECK ((((`work_state` in (_ascii'submit_pending',_ascii'submit_leased')) and (`remote_status` in (_ascii'prepared',_ascii'submitting'))) or ((`work_state` = _ascii'waiting_remote') and (`remote_status` in (_ascii'accepted',_ascii'running'))) or ((`work_state` in (_ascii'query_pending',_ascii'query_leased')) and (`remote_status` in (_ascii'submitting',_ascii'accepted',_ascii'running',_ascii'unknown'))) or ((`work_state` = _ascii'manual') and (`remote_status` = _ascii'unknown')) or ((`work_state` = _ascii'terminal') and (`remote_status` in (_ascii'succeeded',_ascii'failed',_ascii'cancelled',_ascii'not_found'))))),
  CONSTRAINT `chk_provider_invocation_work_state` CHECK ((`work_state` in (_ascii'submit_pending',_ascii'submit_leased',_ascii'waiting_remote',_ascii'query_pending',_ascii'query_leased',_ascii'manual',_ascii'terminal')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_invocation_observation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_invocation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observation_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operation_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `normalized_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stable_error_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `response_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `provider_event_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `execution_generation` int unsigned NOT NULL,
  `adoption_outcome` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observed_at` datetime(3) NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_observation_key` (`provider_invocation_id`,`observation_key`),
  KEY `ix_provider_observation_timeline` (`provider_invocation_id`,`recorded_at`,`id`),
  KEY `ix_provider_observation_workspace` (`workspace_id`,`recorded_at`,`id`),
  KEY `ix_provider_observation_event` (`provider_invocation_id`,`provider_event_digest`),
  CONSTRAINT `fk_provider_observation_invocation` FOREIGN KEY (`provider_invocation_id`) REFERENCES `provider_invocation` (`id`),
  CONSTRAINT `fk_provider_observation_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_observation_adoption` CHECK (((`execution_generation` >= 1) and (`adoption_outcome` in (_ascii'applied',_ascii'noop_terminal',_ascii'noop_cancelled',_ascii'noop_stale',_ascii'manual',_ascii'rejected')))),
  CONSTRAINT `chk_provider_observation_digests` CHECK ((((`request_digest` is null) or (`request_digest` like _ascii'sha256:%')) and ((`response_digest` is null) or (`response_digest` like _ascii'sha256:%')) and ((`provider_event_digest` is null) or (`provider_event_digest` like _ascii'sha256:%')) and ((`normalized_status` <> _ascii'intent') or ((`request_digest` is not null) and (`response_digest` is null))) and ((`operation_kind` <> _ascii'callback') or ((`source` = _ascii'provider_callback') and (`provider_event_digest` is not null))))),
  CONSTRAINT `chk_provider_observation_error` CHECK ((((`normalized_status` in (_ascii'failed',_ascii'unknown')) and (`stable_error_code` is not null)) or ((`normalized_status` not in (_ascii'failed',_ascii'unknown')) and (`stable_error_code` is null)))),
  CONSTRAINT `chk_provider_observation_key` CHECK ((char_length(`observation_key`) between 1 and 160)),
  CONSTRAINT `chk_provider_observation_operation` CHECK ((`operation_kind` in (_ascii'invoke',_ascii'query',_ascii'cancel',_ascii'callback'))),
  CONSTRAINT `chk_provider_observation_source` CHECK ((`source` in (_ascii'consumer',_ascii'adapter',_ascii'provider_callback',_ascii'reconciler',_ascii'operator'))),
  CONSTRAINT `chk_provider_observation_status` CHECK ((`normalized_status` in (_ascii'intent',_ascii'accepted',_ascii'running',_ascii'succeeded',_ascii'failed',_ascii'cancelled',_ascii'not_found',_ascii'unknown'))),
  CONSTRAINT `chk_provider_observation_timestamps` CHECK ((`recorded_at` >= `observed_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_model` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_setting_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `upstream_model_id` varchar(512) NOT NULL,
  `canonical_model_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `catalog_snapshot_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `mapping_source` varchar(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `mapping_confidence` varchar(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `maximum_charge_currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `maximum_charge_amount` decimal(36,12) DEFAULT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `last_seen_at` datetime(3) NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `mapped_at` datetime(3) DEFAULT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  `removed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_model_upstream` (`workspace_id`,`provider_setting_id`,`upstream_model_id`),
  UNIQUE KEY `uq_provider_model_workspace_id` (`workspace_id`,`id`),
  KEY `fk_provider_model_catalog` (`workspace_id`,`catalog_snapshot_id`),
  KEY `fk_provider_model_created_by` (`created_by_principal_id`),
  KEY `fk_provider_model_updated_by` (`updated_by_principal_id`),
  KEY `ix_provider_model_canonical` (`workspace_id`,`canonical_model_id`,`lifecycle_status`,`id`),
  KEY `ix_provider_model_setting_status` (`workspace_id`,`provider_setting_id`,`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_provider_model_canonical` FOREIGN KEY (`workspace_id`, `canonical_model_id`) REFERENCES `canonical_model` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_model_catalog` FOREIGN KEY (`workspace_id`, `catalog_snapshot_id`) REFERENCES `provider_model_catalog_snapshot` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_model_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_provider_model_setting` FOREIGN KEY (`workspace_id`, `provider_setting_id`) REFERENCES `provider_setting` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_model_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_provider_model_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_model_identity` CHECK (((char_length(`upstream_model_id`) between 1 and 512) and (`upstream_model_id` = trim(`upstream_model_id`)) and (`version` >= 1) and (`updated_at` >= `created_at`) and (`last_seen_at` >= `created_at`) and (((`canonical_model_id` is null) and (`mapping_source` is null) and (`mapping_confidence` is null)) or ((`canonical_model_id` is not null) and (`mapping_source` in (_ascii'models_dev',_ascii'provider',_ascii'manual')) and (`mapping_confidence` in (_ascii'exact',_ascii'suggested',_ascii'manual')))) and (((`maximum_charge_currency_code` is null) and (`maximum_charge_amount` is null)) or (regexp_like(`maximum_charge_currency_code`,_ascii'^[A-Z]{3}$') and (`maximum_charge_amount` > 0))))),
  CONSTRAINT `chk_provider_model_lifecycle` CHECK (((`lifecycle_status` in (_ascii'discovered',_ascii'mapped',_ascii'active',_ascii'disabled',_ascii'removed')) and ((`mapped_at` is null) or (`mapped_at` >= `created_at`)) and ((`activated_at` is null) or (`activated_at` >= `created_at`)) and ((`disabled_at` is null) or (`disabled_at` >= `created_at`)) and ((`removed_at` is null) or (`removed_at` >= `created_at`)) and (((`lifecycle_status` = _ascii'discovered') and (`canonical_model_id` is null) and (`mapped_at` is null) and (`activated_at` is null) and (`disabled_at` is null) and (`removed_at` is null)) or ((`lifecycle_status` = _ascii'mapped') and (`canonical_model_id` is not null) and (`mapped_at` is not null) and (`activated_at` is null) and (`disabled_at` is null) and (`removed_at` is null)) or ((`lifecycle_status` = _ascii'active') and (`canonical_model_id` is not null) and (`maximum_charge_currency_code` is not null) and (`maximum_charge_amount` is not null) and (`mapped_at` is not null) and (`activated_at` is not null) and (`disabled_at` is null) and (`removed_at` is null)) or ((`lifecycle_status` = _ascii'disabled') and (`canonical_model_id` is not null) and (`maximum_charge_currency_code` is not null) and (`maximum_charge_amount` is not null) and (`mapped_at` is not null) and (`activated_at` is not null) and (`disabled_at` is not null) and (`removed_at` is null)) or ((`lifecycle_status` = _ascii'removed') and (`removed_at` is not null)))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_model_catalog_snapshot` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_setting_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `discovery_method` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `catalog_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `discovered_at` datetime(3) NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_model_catalog_revision` (`workspace_id`,`provider_setting_id`,`revision`),
  UNIQUE KEY `uq_provider_model_catalog_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_provider_model_catalog_workspace_id_revision` (`workspace_id`,`id`,`revision`),
  KEY `fk_provider_model_catalog_endpoint` (`workspace_id`,`provider_endpoint_id`),
  KEY `fk_provider_model_catalog_created_by` (`created_by_principal_id`),
  KEY `ix_provider_model_catalog_latest` (`workspace_id`,`provider_setting_id`,`revision`,`discovered_at`),
  CONSTRAINT `fk_provider_model_catalog_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_provider_model_catalog_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_model_catalog_setting` FOREIGN KEY (`workspace_id`, `provider_setting_id`) REFERENCES `provider_setting` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_model_catalog_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_model_catalog_document` CHECK (((`revision` >= 1) and (`schema_version` = 1) and (char_length(`discovery_method`) between 1 and 120) and regexp_like(`source_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (json_type(`catalog_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`created_at` >= `discovered_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_setting` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` varchar(160) NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requested_model_keys` json NOT NULL,
  `model_pricing_configurations` json DEFAULT NULL,
  `model_catalog_snapshot_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `model_catalog_revision` int unsigned DEFAULT NULL,
  `activated_model_catalog_snapshot_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `activated_model_catalog_revision` int unsigned DEFAULT NULL,
  `model_catalog_changes_pending_review` tinyint(1) NOT NULL DEFAULT '0',
  `model_profile_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `model_deployment_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pricing_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `route_policy_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `budget_account_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_setting_endpoint` (`workspace_id`,`provider_endpoint_id`),
  UNIQUE KEY `uq_provider_setting_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_provider_setting_credential` (`workspace_id`,`credential_id`),
  UNIQUE KEY `uq_provider_setting_idempotency` (`workspace_id`,`idempotency_key`),
  KEY `fk_provider_setting_created_by` (`created_by_principal_id`),
  KEY `fk_provider_setting_model_profile` (`workspace_id`,`model_profile_revision_id`),
  KEY `fk_provider_setting_model_deployment` (`workspace_id`,`model_deployment_id`),
  KEY `fk_provider_setting_pricing` (`workspace_id`,`pricing_revision_id`),
  KEY `fk_provider_setting_route` (`workspace_id`,`route_policy_revision_id`),
  KEY `fk_provider_setting_budget` (`workspace_id`,`budget_account_id`),
  KEY `ix_provider_setting_workspace` (`workspace_id`,`updated_at`,`id`),
  KEY `fk_provider_setting_current_catalog` (`workspace_id`,`model_catalog_snapshot_id`,`model_catalog_revision`),
  KEY `fk_provider_setting_activated_catalog` (`workspace_id`,`activated_model_catalog_snapshot_id`,`activated_model_catalog_revision`),
  KEY `ix_provider_setting_visible` (`workspace_id`,`deleted_at`,`updated_at`,`id`),
  CONSTRAINT `fk_provider_setting_activated_catalog` FOREIGN KEY (`workspace_id`, `activated_model_catalog_snapshot_id`, `activated_model_catalog_revision`) REFERENCES `provider_model_catalog_snapshot` (`workspace_id`, `id`, `revision`),
  CONSTRAINT `fk_provider_setting_budget` FOREIGN KEY (`workspace_id`, `budget_account_id`) REFERENCES `budget_account` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_provider_setting_credential` FOREIGN KEY (`workspace_id`, `credential_id`) REFERENCES `credential` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_current_catalog` FOREIGN KEY (`workspace_id`, `model_catalog_snapshot_id`, `model_catalog_revision`) REFERENCES `provider_model_catalog_snapshot` (`workspace_id`, `id`, `revision`),
  CONSTRAINT `fk_provider_setting_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_model_deployment` FOREIGN KEY (`workspace_id`, `model_deployment_id`) REFERENCES `model_deployment` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_model_profile` FOREIGN KEY (`workspace_id`, `model_profile_revision_id`) REFERENCES `model_profile_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_pricing` FOREIGN KEY (`workspace_id`, `pricing_revision_id`) REFERENCES `pricing_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_route` FOREIGN KEY (`workspace_id`, `route_policy_revision_id`) REFERENCES `route_policy_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_provider_setting_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_provider_setting_activated_catalog_pointer` CHECK ((((`activated_model_catalog_snapshot_id` is null) and (`activated_model_catalog_revision` is null)) or ((`activated_model_catalog_snapshot_id` is not null) and (`activated_model_catalog_revision` >= 1)))),
  CONSTRAINT `chk_provider_setting_catalog_pointer` CHECK ((((`model_catalog_snapshot_id` is null) and (`model_catalog_revision` is null)) or ((`model_catalog_snapshot_id` is not null) and (`model_catalog_revision` >= 1)))),
  CONSTRAINT `chk_provider_setting_catalog_review` CHECK (((`model_catalog_changes_pending_review` in (0,1)) and ((`model_catalog_changes_pending_review` = 0) or ((`model_catalog_snapshot_id` is not null) and (`model_catalog_revision` >= 1) and ((`activated_model_catalog_snapshot_id` is not null) or ((`model_deployment_id` is not null) and (`activated_model_catalog_snapshot_id` is null) and (`activated_model_catalog_revision` is null))))))),
  CONSTRAINT `chk_provider_setting_values` CHECK (((char_length(trim(`display_name`)) between 1 and 160) and (json_type(`requested_model_keys`) = _utf8mb4'ARRAY') and (json_length(`requested_model_keys`) between 0 and 32) and (char_length(`idempotency_key`) between 1 and 160) and regexp_like(`request_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`version` >= 1) and (`updated_at` >= `created_at`) and ((`activated_at` is null) or (`activated_at` >= `created_at`)) and ((`disabled_at` is null) or (`disabled_at` >= `created_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `provider_setting_operation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_setting_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operation_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`idempotency_key`),
  KEY `fk_provider_setting_operation_setting` (`workspace_id`,`provider_setting_id`),
  CONSTRAINT `fk_provider_setting_operation_setting` FOREIGN KEY (`workspace_id`, `provider_setting_id`) REFERENCES `provider_setting` (`workspace_id`, `id`),
  CONSTRAINT `chk_provider_setting_operation` CHECK (((char_length(`idempotency_key`) between 1 and 160) and (`operation_kind` in (_ascii'validate',_ascii'activate',_ascii'rotate_secret',_ascii'disable',_ascii'delete',_ascii'refresh_model_catalog',_ascii'adopt_model_catalog')) and regexp_like(`request_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`result_version` >= 1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `publication_candidate` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subject_kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subject_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_draft_version` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `content_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parser_profile_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_publication_candidate_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_publication_candidate_draft_version` (`workspace_id`,`subject_kind`,`source_draft_id`,`source_draft_version`),
  KEY `fk_publication_candidate_actor` (`created_by_principal_id`),
  KEY `ix_publication_candidate_subject` (`workspace_id`,`subject_kind`,`subject_key`,`created_at`,`id`),
  CONSTRAINT `fk_publication_candidate_actor` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_publication_candidate_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_publication_candidate_digest` CHECK (regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_publication_candidate_document` CHECK ((json_type(`content_document`) = _utf8mb4'OBJECT')),
  CONSTRAINT `chk_publication_candidate_kind` CHECK ((`subject_kind` in (_ascii'workflow',_ascii'skill'))),
  CONSTRAINT `chk_publication_candidate_profile` CHECK ((char_length(`parser_profile_version`) between 1 and 80)),
  CONSTRAINT `chk_publication_candidate_schema` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_publication_candidate_source_version` CHECK ((`source_draft_version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `publication_check` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `check_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `check_profile_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `outcome` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence_summary` json NOT NULL,
  `evidence_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `checked_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `checked_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_publication_check_slot` (`workspace_id`,`publication_candidate_id`,`check_kind`),
  KEY `fk_publication_check_actor` (`checked_by_principal_id`),
  KEY `ix_publication_check_candidate` (`workspace_id`,`publication_candidate_id`,`outcome`),
  CONSTRAINT `fk_publication_check_actor` FOREIGN KEY (`checked_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_publication_check_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `chk_publication_check_evidence` CHECK (((json_type(`evidence_summary`) = _utf8mb4'OBJECT') and regexp_like(`evidence_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_publication_check_kind` CHECK ((`check_kind` in (_ascii'schema',_ascii'resources',_ascii'security',_ascii'compatibility',_ascii'eval'))),
  CONSTRAINT `chk_publication_check_outcome` CHECK ((`outcome` in (_ascii'passed',_ascii'failed'))),
  CONSTRAINT `chk_publication_check_profile` CHECK ((char_length(`check_profile_version`) between 1 and 80))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `publication_review_decision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `comment_summary` varchar(1000) DEFAULT NULL,
  `candidate_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reviewer_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decided_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_publication_review_candidate` (`workspace_id`,`publication_candidate_id`),
  KEY `fk_publication_review_actor` (`reviewer_principal_id`),
  CONSTRAINT `fk_publication_review_actor` FOREIGN KEY (`reviewer_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_publication_review_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `chk_publication_review_decision` CHECK ((`decision` in (_ascii'approved',_ascii'rejected'))),
  CONSTRAINT `chk_publication_review_digest` CHECK (regexp_like(`candidate_digest`,_ascii'^sha256:[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `queue_delivery_failure` (
  `consumer_name` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `queue_name` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `job_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `outbox_event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `error_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `occurrence_count` int unsigned NOT NULL DEFAULT '1',
  `resolution_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `first_observed_at` datetime(3) NOT NULL,
  `last_observed_at` datetime(3) NOT NULL,
  `resolved_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`consumer_name`,`queue_name`,`job_id`),
  KEY `ix_queue_delivery_failure_status` (`resolution_status`,`last_observed_at`,`consumer_name`,`queue_name`),
  KEY `ix_queue_delivery_failure_event` (`outbox_event_id`,`consumer_name`),
  CONSTRAINT `chk_queue_delivery_failure_count` CHECK ((`occurrence_count` >= 1)),
  CONSTRAINT `chk_queue_delivery_failure_resolution` CHECK ((((`resolution_status` = _ascii'quarantined') and (`resolved_at` is null)) or ((`resolution_status` in (_ascii'resolved',_ascii'ignored')) and (`resolved_at` is not null)))),
  CONSTRAINT `chk_queue_delivery_failure_timestamps` CHECK (((`last_observed_at` >= `first_observed_at`) and ((`resolved_at` is null) or (`resolved_at` >= `first_observed_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recovery_operation` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `instance_id` varchar(120) NOT NULL,
  `backup_set_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `manifest_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fenced_execution_generation` int unsigned NOT NULL,
  `begin_state_version` int unsigned NOT NULL,
  `verification_result_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `verification_summary` json DEFAULT NULL,
  `activation_ack_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `last_failure_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `started_at` datetime(3) NOT NULL,
  `verification_started_at` datetime(3) DEFAULT NULL,
  `verified_at` datetime(3) DEFAULT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `aborted_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recovery_operation_instance_id` (`instance_id`,`id`),
  KEY `ix_recovery_operation_active` (`instance_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_recovery_operation_backup` (`backup_set_id`,`manifest_digest`,`started_at`,`id`),
  CONSTRAINT `fk_recovery_operation_instance` FOREIGN KEY (`instance_id`) REFERENCES `instance_runtime_state` (`instance_id`),
  CONSTRAINT `chk_recovery_operation_abort` CHECK ((((`lifecycle_status` = _ascii'aborted') and (`aborted_at` is not null)) or ((`lifecycle_status` <> _ascii'aborted') and (`aborted_at` is null)))),
  CONSTRAINT `chk_recovery_operation_activation` CHECK ((((`lifecycle_status` = _ascii'active') and regexp_like(`activation_ack_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`activated_at` is not null) and (`aborted_at` is null)) or ((`lifecycle_status` <> _ascii'active') and (`activation_ack_digest` is null) and (`activated_at` is null)))),
  CONSTRAINT `chk_recovery_operation_failure` CHECK (((`last_failure_code` is null) or ((`lifecycle_status` = _ascii'verifying') and (char_length(`last_failure_code`) between 1 and 120)))),
  CONSTRAINT `chk_recovery_operation_identity` CHECK ((regexp_like(`manifest_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`fenced_execution_generation` >= 1) and (`begin_state_version` >= 1) and (`version` >= 1))),
  CONSTRAINT `chk_recovery_operation_status` CHECK ((`lifecycle_status` in (_ascii'restoring',_ascii'verifying',_ascii'read_only',_ascii'active',_ascii'aborted'))),
  CONSTRAINT `chk_recovery_operation_time` CHECK (((`updated_at` >= `started_at`) and ((`verification_started_at` is null) or (`verification_started_at` >= `started_at`)) and ((`verified_at` is null) or ((`verification_started_at` is not null) and (`verified_at` >= `verification_started_at`))) and ((`activated_at` is null) or ((`verified_at` is not null) and (`activated_at` >= `verified_at`))) and ((`aborted_at` is null) or (`aborted_at` >= `started_at`)))),
  CONSTRAINT `chk_recovery_operation_verification` CHECK ((((`lifecycle_status` = _ascii'restoring') and (`verification_started_at` is null) and (`verification_result_digest` is null) and (`verification_summary` is null) and (`verified_at` is null)) or ((`lifecycle_status` = _ascii'verifying') and (`verification_started_at` is not null) and (`verification_result_digest` is null) and (`verification_summary` is null) and (`verified_at` is null)) or ((`lifecycle_status` in (_ascii'read_only',_ascii'active')) and (`verification_started_at` is not null) and regexp_like(`verification_result_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (json_type(`verification_summary`) = _utf8mb4'OBJECT') and (`verified_at` is not null)) or (`lifecycle_status` = _ascii'aborted')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resource_source` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` varchar(160) NOT NULL,
  `adapter_kind` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `auth_mode` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `configuration_document` json NOT NULL,
  `configuration_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `license_policy` json NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `validation_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `validated_at` datetime(3) DEFAULT NULL,
  `current_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resource_source_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_resource_source_endpoint` (`workspace_id`,`provider_endpoint_id`),
  UNIQUE KEY `uq_resource_source_idempotency` (`workspace_id`,`idempotency_key`),
  UNIQUE KEY `uq_resource_source_credential` (`workspace_id`,`credential_id`),
  KEY `fk_resource_source_created_by` (`created_by_principal_id`),
  KEY `fk_resource_source_updated_by` (`updated_by_principal_id`),
  KEY `ix_resource_source_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_resource_source_current_revision` (`workspace_id`,`id`,`current_revision_id`),
  CONSTRAINT `fk_resource_source_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_resource_source_credential` FOREIGN KEY (`workspace_id`, `credential_id`) REFERENCES `credential` (`workspace_id`, `id`),
  CONSTRAINT `fk_resource_source_current_revision` FOREIGN KEY (`workspace_id`, `id`, `current_revision_id`) REFERENCES `resource_source_revision` (`workspace_id`, `source_id`, `id`),
  CONSTRAINT `fk_resource_source_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_resource_source_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_resource_source_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_resource_source_auth` CHECK ((((`auth_mode` = _ascii'none') and (`credential_id` is null)) or ((`auth_mode` in (_ascii'api_key',_ascii'client_credentials')) and (`credential_id` is not null)))),
  CONSTRAINT `chk_resource_source_disabled` CHECK ((((`lifecycle_status` = _ascii'disabled') and (`disabled_at` is not null)) or ((`lifecycle_status` <> _ascii'disabled') and (`disabled_at` is null)))),
  CONSTRAINT `chk_resource_source_identity` CHECK (((char_length(`display_name`) between 1 and 160) and regexp_like(`adapter_kind`,_ascii'^[A-Za-z0-9][A-Za-z0-9._:-]*$') and (char_length(`adapter_version`) between 1 and 80) and regexp_like(`configuration_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_resource_source_lifecycle` CHECK ((`lifecycle_status` in (_ascii'draft',_ascii'validating',_ascii'ready',_ascii'published',_ascii'failed',_ascii'disabled'))),
  CONSTRAINT `chk_resource_source_publication` CHECK ((((`lifecycle_status` = _ascii'published') and (`current_revision_id` is not null)) or (`lifecycle_status` <> _ascii'published'))),
  CONSTRAINT `chk_resource_source_validation` CHECK ((((`validation_status` in (_ascii'not_checked',_ascii'pending')) and (`validation_digest` is null) and (`validation_reason_code` is null) and (`validated_at` is null)) or ((`validation_status` in (_ascii'passed',_ascii'failed')) and regexp_like(`validation_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`validation_reason_code` is not null) and (`validated_at` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resource_source_operation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operation_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `planned_resource_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_source_version` int unsigned DEFAULT NULL,
  `result_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`workspace_id`,`idempotency_key`),
  UNIQUE KEY `uq_resource_source_operation_id` (`workspace_id`,`operation_id`),
  KEY `ix_resource_source_operation_source` (`workspace_id`,`source_id`,`created_at`),
  CONSTRAINT `fk_resource_source_operation_source` FOREIGN KEY (`workspace_id`, `source_id`) REFERENCES `resource_source` (`workspace_id`, `id`),
  CONSTRAINT `chk_resource_source_operation_identity` CHECK (((`operation_kind` in (_ascii'validate',_ascii'disable',_ascii'rotate_secret')) and regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_resource_source_operation_result` CHECK ((((`status` = _ascii'pending') and (`result_source_version` is null) and (`result_reason_code` is null) and (`completed_at` is null)) or ((`status` = _ascii'succeeded') and (`result_source_version` >= 1) and (`result_reason_code` is not null) and (`completed_at` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resource_source_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_number` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `adapter_kind` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_endpoint_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `configuration_document` json NOT NULL,
  `configuration_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capabilities` json NOT NULL,
  `license_policy` json NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resource_source_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_resource_source_revision_scoped_id` (`workspace_id`,`source_id`,`id`),
  UNIQUE KEY `uq_resource_source_revision_number` (`workspace_id`,`source_id`,`revision_number`),
  UNIQUE KEY `uq_resource_source_revision_digest` (`workspace_id`,`source_id`,`content_digest`),
  UNIQUE KEY `uq_resource_source_publication_request` (`workspace_id`,`publication_request_key`),
  KEY `fk_resource_source_revision_endpoint` (`workspace_id`,`provider_endpoint_id`),
  KEY `fk_resource_source_revision_credential` (`workspace_id`,`credential_id`),
  KEY `fk_resource_source_revision_published_by` (`published_by_principal_id`),
  KEY `ix_resource_source_revision_recent` (`workspace_id`,`source_id`,`revision_number`),
  CONSTRAINT `fk_resource_source_revision_credential` FOREIGN KEY (`workspace_id`, `credential_id`) REFERENCES `credential` (`workspace_id`, `id`),
  CONSTRAINT `fk_resource_source_revision_endpoint` FOREIGN KEY (`workspace_id`, `provider_endpoint_id`) REFERENCES `provider_endpoint` (`workspace_id`, `id`),
  CONSTRAINT `fk_resource_source_revision_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_resource_source_revision_source` FOREIGN KEY (`workspace_id`, `source_id`) REFERENCES `resource_source` (`workspace_id`, `id`),
  CONSTRAINT `chk_resource_source_revision_identity` CHECK (((`revision_number` >= 1) and (`schema_version` = 1) and regexp_like(`configuration_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`publication_request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (json_length(`capabilities`) between 1 and 8)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `route_policy_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `route_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `route_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_route_policy_revision` (`workspace_id`,`route_key`,`revision`),
  UNIQUE KEY `uq_route_policy_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_route_policy_workspace_id` (`workspace_id`,`id`),
  KEY `fk_route_policy_created_by` (`created_by_principal_id`),
  KEY `fk_route_policy_published_by` (`published_by_principal_id`),
  CONSTRAINT `fk_route_policy_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_route_policy_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_route_policy_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_route_policy_document` CHECK (((`revision` >= 1) and (`schema_version` >= 1) and (json_type(`route_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_route_policy_lifecycle` CHECK ((`lifecycle_status` in (_ascii'published',_ascii'deprecated',_ascii'revoked'))),
  CONSTRAINT `chk_route_policy_time` CHECK ((`published_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `runtime_adapter_definition` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_key` varchar(160) NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `current_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_runtime_adapter_definition_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_runtime_adapter_definition_key` (`workspace_id`,`adapter_key`),
  KEY `ix_runtime_adapter_definition_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_runtime_adapter_definition_current_revision` (`current_revision_id`),
  CONSTRAINT `fk_runtime_adapter_definition_current_revision` FOREIGN KEY (`current_revision_id`) REFERENCES `runtime_adapter_revision` (`id`),
  CONSTRAINT `fk_runtime_adapter_definition_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `runtime_adapter_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_adapter_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `execution_target` varchar(24) NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document` json NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_runtime_adapter_revision_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_runtime_adapter_revision_number` (`workspace_id`,`runtime_adapter_definition_id`,`revision`),
  UNIQUE KEY `uq_runtime_adapter_revision_digest` (`workspace_id`,`canonical_digest`),
  CONSTRAINT `fk_runtime_adapter_revision_definition` FOREIGN KEY (`workspace_id`, `runtime_adapter_definition_id`) REFERENCES `runtime_adapter_definition` (`workspace_id`, `id`),
  CONSTRAINT `chk_runtime_adapter_revision_status` CHECK ((`lifecycle_status` in (_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked'))),
  CONSTRAINT `chk_runtime_adapter_revision_target` CHECK ((`execution_target` in (_utf8mb4'browser',_utf8mb4'worker',_utf8mb4'provider')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `secret_version` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credential_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `material_generation` int unsigned NOT NULL,
  `source_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `material_plaintext_base64` mediumtext CHARACTER SET ascii COLLATE ascii_bin,
  `material_ciphertext_base64` mediumtext CHARACTER SET ascii COLLATE ascii_bin,
  `material_nonce_base64` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `material_auth_tag_base64` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `wrapped_dek_base64` varchar(512) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `wrap_nonce_base64` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `wrap_auth_tag_base64` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `kek_version` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `aad_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `deployment_reference` varchar(512) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `material_fingerprint` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `format_version` smallint unsigned NOT NULL,
  `drain_deadline_at` datetime(3) DEFAULT NULL,
  `verified_at` datetime(3) DEFAULT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `retired_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `destroyed_at` datetime(3) DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_secret_version_number` (`credential_id`,`version`),
  UNIQUE KEY `uq_secret_version_generation` (`credential_id`,`material_generation`),
  UNIQUE KEY `uq_secret_version_workspace_credential_id` (`workspace_id`,`credential_id`,`id`),
  KEY `fk_secret_version_created_by` (`created_by_principal_id`),
  KEY `ix_secret_version_lifecycle` (`workspace_id`,`credential_id`,`lifecycle_status`,`id`),
  CONSTRAINT `fk_secret_version_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_secret_version_credential` FOREIGN KEY (`workspace_id`, `credential_id`) REFERENCES `credential` (`workspace_id`, `id`),
  CONSTRAINT `chk_secret_version_drain` CHECK ((((`lifecycle_status` = _ascii'draining') and (`drain_deadline_at` is not null) and (`activated_at` is not null) and (`drain_deadline_at` > `activated_at`)) or ((`lifecycle_status` <> _ascii'draining') and (`drain_deadline_at` is null)))),
  CONSTRAINT `chk_secret_version_identity` CHECK (((`version` >= 1) and (`material_generation` >= 1) and regexp_like(`aad_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`material_fingerprint`,_ascii'^sha256:[0-9a-f]{64}$') and (`format_version` >= 1))),
  CONSTRAINT `chk_secret_version_lifecycle` CHECK ((`lifecycle_status` in (_ascii'created',_ascii'verified',_ascii'active',_ascii'draining',_ascii'retired',_ascii'revoked',_ascii'restore_only',_ascii'destroyed'))),
  CONSTRAINT `chk_secret_version_source` CHECK ((((`lifecycle_status` <> _ascii'destroyed') and (`source_kind` = _ascii'plaintext_database') and (`material_plaintext_base64` is not null) and (char_length(`material_plaintext_base64`) between 1 and 87384) and (`material_ciphertext_base64` is null) and (`material_nonce_base64` is null) and (`material_auth_tag_base64` is null) and (`wrapped_dek_base64` is null) and (`wrap_nonce_base64` is null) and (`wrap_auth_tag_base64` is null) and (`kek_version` is null) and (`deployment_reference` is null)) or ((`lifecycle_status` <> _ascii'destroyed') and (`source_kind` = _ascii'encrypted_database') and (`material_plaintext_base64` is null) and (`material_ciphertext_base64` is not null) and (char_length(`material_ciphertext_base64`) between 1 and 65536) and (`material_nonce_base64` is not null) and (`material_auth_tag_base64` is not null) and (`wrapped_dek_base64` is not null) and (`wrap_nonce_base64` is not null) and (`wrap_auth_tag_base64` is not null) and (`kek_version` is not null) and (`deployment_reference` is null)) or ((`lifecycle_status` <> _ascii'destroyed') and (`source_kind` = _ascii'deployment_reference') and (`material_plaintext_base64` is null) and (`material_ciphertext_base64` is null) and (`material_nonce_base64` is null) and (`material_auth_tag_base64` is null) and (`wrapped_dek_base64` is null) and (`wrap_nonce_base64` is null) and (`wrap_auth_tag_base64` is null) and (`kek_version` is null) and (`deployment_reference` is not null) and (char_length(`deployment_reference`) between 1 and 512)) or ((`lifecycle_status` = _ascii'destroyed') and (`material_plaintext_base64` is null) and (`material_ciphertext_base64` is null) and (`material_nonce_base64` is null) and (`material_auth_tag_base64` is null) and (`wrapped_dek_base64` is null) and (`wrap_nonce_base64` is null) and (`wrap_auth_tag_base64` is null) and (`kek_version` is null) and (`deployment_reference` is null)))),
  CONSTRAINT `chk_secret_version_timestamps` CHECK ((((`verified_at` is null) or (`verified_at` >= `created_at`)) and ((`activated_at` is null) or (`activated_at` >= `created_at`)) and ((`retired_at` is null) or (`retired_at` >= `created_at`)) and ((`revoked_at` is null) or (`revoked_at` >= `created_at`)) and ((`destroyed_at` is null) or (`destroyed_at` >= `created_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_api_token` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `service_grant_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_key_id` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_prefix` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hash_version` smallint unsigned NOT NULL,
  `permission_set` json NOT NULL,
  `permission_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `last_used_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_api_token_key_id` (`token_key_id`),
  UNIQUE KEY `uq_service_api_token_hash` (`token_hash`),
  KEY `fk_service_api_token_grant` (`service_grant_id`),
  KEY `ix_service_api_token_prefix` (`token_prefix`,`expires_at`,`id`),
  CONSTRAINT `fk_service_api_token_grant` FOREIGN KEY (`service_grant_id`) REFERENCES `service_grant` (`id`),
  CONSTRAINT `chk_service_api_token_hash` CHECK ((regexp_like(`token_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`hash_version` >= 1))),
  CONSTRAINT `chk_service_api_token_permissions` CHECK (((json_type(`permission_set`) = _utf8mb4'ARRAY') and regexp_like(`permission_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_service_api_token_time` CHECK (((`expires_at` > `created_at`) and ((`last_used_at` is null) or (`last_used_at` >= `created_at`)) and ((`revoked_at` is null) or (`revoked_at` >= `created_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_grant` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `service_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission_set` json NOT NULL,
  `permission_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_grant_workspace` (`service_principal_id`,`workspace_id`),
  UNIQUE KEY `uq_service_grant_scope_id` (`workspace_id`,`id`),
  KEY `fk_service_grant_principal` (`organization_id`,`service_principal_id`),
  KEY `fk_service_grant_workspace` (`organization_id`,`workspace_id`),
  KEY `ix_service_grant_workspace_status` (`workspace_id`,`status`,`id`),
  CONSTRAINT `fk_service_grant_principal` FOREIGN KEY (`organization_id`, `service_principal_id`) REFERENCES `service_principal` (`organization_id`, `principal_id`),
  CONSTRAINT `fk_service_grant_workspace` FOREIGN KEY (`organization_id`, `workspace_id`) REFERENCES `workspace` (`organization_id`, `id`),
  CONSTRAINT `chk_service_grant_permissions` CHECK (((json_type(`permission_set`) = _utf8mb4'ARRAY') and regexp_like(`permission_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_service_grant_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'revoked'))),
  CONSTRAINT `chk_service_grant_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_principal` (
  `principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `service_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(160) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`principal_id`),
  UNIQUE KEY `uq_service_principal_key` (`organization_id`,`service_key`),
  UNIQUE KEY `uq_service_principal_organization_id` (`organization_id`,`principal_id`),
  CONSTRAINT `fk_service_principal_organization` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`),
  CONSTRAINT `fk_service_principal_principal` FOREIGN KEY (`principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_service_principal_time` CHECK ((`updated_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_definition` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `visibility` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  `usage_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'enabled',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_skill_definition_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_skill_definition_key` (`workspace_id`,`skill_key`),
  UNIQUE KEY `uq_skill_definition_creation_request` (`workspace_id`,`creation_request_key`),
  KEY `ix_skill_definition_discover` (`workspace_id`,`visibility`,`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_skill_definition_owner` (`workspace_id`,`owner_principal_id`,`lifecycle_status`,`updated_at`,`id`),
  KEY `fk_skill_definition_owner` (`owner_principal_id`),
  KEY `fk_skill_definition_creator` (`created_by_principal_id`),
  KEY `fk_skill_definition_updater` (`updated_by_principal_id`),
  CONSTRAINT `fk_skill_definition_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_definition_owner` FOREIGN KEY (`owner_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_definition_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_definition_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_skill_definition_archive` CHECK ((((`lifecycle_status` = _ascii'active') and (`archived_at` is null)) or ((`lifecycle_status` = _ascii'archived') and (`archived_at` is not null)))),
  CONSTRAINT `chk_skill_definition_digest` CHECK (regexp_like(`creation_request_hash`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_skill_definition_lifecycle` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived'))),
  CONSTRAINT `chk_skill_definition_usage` CHECK ((`usage_status` in (_utf8mb4'enabled',_utf8mb4'disabled'))),
  CONSTRAINT `chk_skill_definition_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`))),
  CONSTRAINT `chk_skill_definition_visibility` CHECK ((`visibility` in (_ascii'private',_ascii'workspace')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_derivation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_thread_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`skill_definition_id`),
  KEY `fk_skill_derivation_thread` (`workspace_id`,`source_thread_id`),
  KEY `fk_skill_derivation_run` (`workspace_id`,`source_run_id`),
  KEY `fk_skill_derivation_artifact` (`workspace_id`,`source_artifact_id`),
  KEY `fk_skill_derivation_creator` (`created_by_principal_id`),
  CONSTRAINT `fk_skill_derivation_artifact` FOREIGN KEY (`workspace_id`, `source_artifact_id`) REFERENCES `artifact` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_derivation_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_derivation_definition` FOREIGN KEY (`workspace_id`, `skill_definition_id`) REFERENCES `skill_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_derivation_run` FOREIGN KEY (`workspace_id`, `source_run_id`) REFERENCES `agent_run` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_derivation_thread` FOREIGN KEY (`workspace_id`, `source_thread_id`) REFERENCES `agent_thread` (`workspace_id`, `id`),
  CONSTRAINT `chk_skill_derivation_digest` CHECK (regexp_like(`source_digest`,_utf8mb4'^sha256:[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_draft` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `content_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `derived_from_skill_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_skill_draft_key` (`workspace_id`,`skill_key`),
  UNIQUE KEY `uq_skill_draft_workspace_id` (`workspace_id`,`id`),
  KEY `fk_skill_draft_derived` (`workspace_id`,`derived_from_skill_revision_id`),
  KEY `fk_skill_draft_creator` (`created_by_principal_id`),
  KEY `fk_skill_draft_updater` (`updated_by_principal_id`),
  KEY `fk_skill_draft_definition` (`workspace_id`,`skill_definition_id`),
  CONSTRAINT `fk_skill_draft_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_draft_definition` FOREIGN KEY (`workspace_id`, `skill_definition_id`) REFERENCES `skill_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_draft_derived` FOREIGN KEY (`workspace_id`, `derived_from_skill_revision_id`) REFERENCES `skill_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_draft_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_draft_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_skill_draft_digest` CHECK (regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_skill_draft_document` CHECK ((json_type(`content_document`) = _utf8mb4'OBJECT')),
  CONSTRAINT `chk_skill_draft_schema` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_skill_draft_status` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived'))),
  CONSTRAINT `chk_skill_draft_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_package_import` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `raw_archive_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parser_profile_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inventory_summary` json DEFAULT NULL,
  `inventory_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `logical_package_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `rejection_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `adopted_skill_draft_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `adopted_publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_skill_import_source` (`workspace_id`,`source_stored_object_id`,`raw_archive_sha256`,`parser_profile_version`),
  KEY `fk_skill_import_draft` (`workspace_id`,`adopted_skill_draft_id`),
  KEY `fk_skill_import_candidate` (`workspace_id`,`adopted_publication_candidate_id`),
  KEY `fk_skill_import_actor` (`created_by_principal_id`),
  KEY `ix_skill_import_state` (`workspace_id`,`state`,`updated_at`,`id`),
  CONSTRAINT `fk_skill_import_actor` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_import_candidate` FOREIGN KEY (`workspace_id`, `adopted_publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_import_draft` FOREIGN KEY (`workspace_id`, `adopted_skill_draft_id`) REFERENCES `skill_draft` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_import_source` FOREIGN KEY (`workspace_id`, `source_stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_import_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_skill_import_hash` CHECK (regexp_like(`raw_archive_sha256`,_ascii'^[0-9a-f]{64}$')),
  CONSTRAINT `chk_skill_import_profile` CHECK ((char_length(`parser_profile_version`) between 1 and 80)),
  CONSTRAINT `chk_skill_import_state` CHECK ((((`state` = _ascii'quarantined') and (`inventory_summary` is null) and (`inventory_digest` is null) and (`logical_package_digest` is null) and (`rejection_code` is null) and (`adopted_skill_draft_id` is null) and (`adopted_publication_candidate_id` is null)) or ((`state` = _ascii'validated') and (json_type(`inventory_summary`) = _utf8mb4'OBJECT') and regexp_like(`inventory_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`logical_package_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`rejection_code` is null) and (`adopted_skill_draft_id` is null) and (`adopted_publication_candidate_id` is null)) or ((`state` = _ascii'rejected') and (`rejection_code` is not null) and (char_length(`rejection_code`) between 1 and 120) and (`adopted_skill_draft_id` is null) and (`adopted_publication_candidate_id` is null)) or ((`state` = _ascii'draft_adopted') and (json_type(`inventory_summary`) = _utf8mb4'OBJECT') and regexp_like(`inventory_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`logical_package_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`rejection_code` is null) and (`adopted_skill_draft_id` is not null) and (`adopted_publication_candidate_id` is null)) or ((`state` = _ascii'candidate_linked') and (json_type(`inventory_summary`) = _utf8mb4'OBJECT') and regexp_like(`inventory_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`logical_package_digest`,_ascii'^sha256:[0-9a-f]{64}$') and (`rejection_code` is null) and (`adopted_skill_draft_id` is not null) and (`adopted_publication_candidate_id` is not null)))),
  CONSTRAINT `chk_skill_import_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_presentation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` varchar(160) NOT NULL,
  `summary` varchar(600) NOT NULL,
  `cover_asset_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `tags` json NOT NULL,
  `example_requests` json NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`,`skill_definition_id`),
  KEY `ix_skill_presentation_category` (`workspace_id`,`category`,`updated_at`,`skill_definition_id`),
  KEY `fk_skill_presentation_cover_asset` (`workspace_id`,`cover_asset_id`),
  KEY `fk_skill_presentation_updater` (`updated_by_principal_id`),
  CONSTRAINT `fk_skill_presentation_cover_asset` FOREIGN KEY (`workspace_id`, `cover_asset_id`) REFERENCES `asset` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_presentation_definition` FOREIGN KEY (`workspace_id`, `skill_definition_id`) REFERENCES `skill_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_presentation_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `chk_skill_presentation_examples` CHECK ((json_type(`example_requests`) = _utf8mb4'ARRAY')),
  CONSTRAINT `chk_skill_presentation_tags` CHECK ((json_type(`tags`) = _utf8mb4'ARRAY')),
  CONSTRAINT `chk_skill_presentation_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `manifest_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `package_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parser_profile_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_skill_revision_number` (`workspace_id`,`skill_key`,`revision`),
  UNIQUE KEY `uq_skill_revision_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_skill_revision_candidate` (`workspace_id`,`publication_candidate_id`),
  UNIQUE KEY `uq_skill_revision_workspace_id` (`workspace_id`,`id`),
  KEY `fk_skill_revision_creator` (`created_by_principal_id`),
  KEY `fk_skill_revision_publisher` (`published_by_principal_id`),
  KEY `fk_skill_revision_definition` (`workspace_id`,`skill_definition_id`),
  CONSTRAINT `fk_skill_revision_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_revision_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_revision_definition` FOREIGN KEY (`workspace_id`, `skill_definition_id`) REFERENCES `skill_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_revision_publisher` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_revision_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_skill_revision_digests` CHECK ((regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`package_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_skill_revision_manifest` CHECK ((json_type(`manifest_document`) = _utf8mb4'OBJECT')),
  CONSTRAINT `chk_skill_revision_number` CHECK ((`revision` >= 1)),
  CONSTRAINT `chk_skill_revision_schema` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_skill_revision_status` CHECK ((`lifecycle_status` in (_ascii'published',_ascii'deprecated'))),
  CONSTRAINT `chk_skill_revision_times` CHECK ((`published_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_revision_activation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `skill_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`skill_revision_id`),
  KEY `fk_skill_activation_revision` (`workspace_id`,`skill_revision_id`),
  KEY `fk_skill_activation_actor` (`updated_by_principal_id`),
  KEY `ix_skill_activation_status` (`workspace_id`,`runtime_status`,`updated_at`,`skill_revision_id`),
  CONSTRAINT `fk_skill_activation_actor` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_skill_activation_revision` FOREIGN KEY (`workspace_id`, `skill_revision_id`) REFERENCES `skill_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_skill_activation_reason` CHECK ((((`runtime_status` = _ascii'revoked') and (`reason_code` is not null)) or (`runtime_status` in (_ascii'enabled',_ascii'disabled')))),
  CONSTRAINT `chk_skill_activation_status` CHECK ((`runtime_status` in (_ascii'enabled',_ascii'disabled',_ascii'revoked'))),
  CONSTRAINT `chk_skill_activation_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_revision_resource` (
  `skill_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `resource_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `content_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `media_type` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `byte_size` bigint unsigned NOT NULL,
  `ordinal` int unsigned NOT NULL,
  PRIMARY KEY (`skill_revision_id`,`resource_path`),
  UNIQUE KEY `uq_skill_resource_ordinal` (`skill_revision_id`,`ordinal`),
  KEY `fk_skill_resource_revision` (`workspace_id`,`skill_revision_id`),
  KEY `fk_skill_resource_object` (`workspace_id`,`stored_object_id`),
  CONSTRAINT `fk_skill_resource_object` FOREIGN KEY (`workspace_id`, `stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_resource_revision` FOREIGN KEY (`workspace_id`, `skill_revision_id`) REFERENCES `skill_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_skill_resource_digest` CHECK (regexp_like(`content_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_skill_resource_kind` CHECK ((`resource_kind` in (_ascii'instructions',_ascii'reference',_ascii'template',_ascii'asset',_ascii'eval'))),
  CONSTRAINT `chk_skill_resource_size` CHECK ((`byte_size` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `skill_revision_workflow_entrypoint` (
  `skill_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entrypoint_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  PRIMARY KEY (`skill_revision_id`,`entrypoint_key`),
  UNIQUE KEY `uq_skill_entrypoint_ordinal` (`skill_revision_id`,`ordinal`),
  KEY `fk_skill_entrypoint_revision` (`workspace_id`,`skill_revision_id`),
  KEY `fk_skill_entrypoint_workflow` (`workspace_id`,`workflow_revision_id`),
  CONSTRAINT `fk_skill_entrypoint_revision` FOREIGN KEY (`workspace_id`, `skill_revision_id`) REFERENCES `skill_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_skill_entrypoint_workflow` FOREIGN KEY (`workspace_id`, `workflow_revision_id`) REFERENCES `workflow_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `storage_compatibility_probe` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `probe_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_profile_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `profile_configuration_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `adapter_version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_contract_version` smallint unsigned NOT NULL,
  `supports_conditional_create` tinyint unsigned NOT NULL,
  `supports_server_owned_write` tinyint unsigned NOT NULL,
  `supports_multipart` tinyint unsigned NOT NULL,
  `supports_range_read` tinyint unsigned NOT NULL,
  `supports_version_bound_identity` tinyint unsigned NOT NULL,
  `supports_full_object_checksum` tinyint unsigned NOT NULL,
  `sealed_identity_immutable` tinyint unsigned NOT NULL,
  `probe_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `failure_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `result_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence` json NOT NULL,
  `tested_at` datetime(3) NOT NULL,
  `valid_until` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_probe_request` (`workspace_id`,`probe_key`),
  UNIQUE KEY `uq_storage_probe_workspace_id` (`workspace_id`,`id`),
  KEY `ix_storage_probe_profile` (`workspace_id`,`storage_profile_id`,`profile_configuration_hash`,`probe_status`,`valid_until`),
  CONSTRAINT `fk_storage_probe_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_storage_probe_capabilities` CHECK (((`supports_conditional_create` in (0,1)) and (`supports_server_owned_write` in (0,1)) and (`supports_multipart` in (0,1)) and (`supports_range_read` in (0,1)) and (`supports_version_bound_identity` in (0,1)) and (`supports_full_object_checksum` in (0,1)) and (`sealed_identity_immutable` in (0,1)))),
  CONSTRAINT `chk_storage_probe_hashes` CHECK ((regexp_like(`request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`profile_configuration_hash`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`result_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_storage_probe_status` CHECK ((((`probe_status` = _ascii'passed') and (`failure_code` is null) and (`sealed_identity_immutable` = 1) and (`supports_range_read` = 1)) or ((`probe_status` = _ascii'failed') and (`failure_code` is not null) and (char_length(`failure_code`) between 1 and 120)))),
  CONSTRAINT `chk_storage_probe_time` CHECK (((`capability_contract_version` >= 1) and (`valid_until` > `tested_at`) and (`created_at` >= `tested_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stored_object` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_from_upload_session_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_profile_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `container` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `object_key` varchar(800) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_version_id` varchar(240) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `provider_etag` varchar(240) DEFAULT NULL,
  `immutable_identity_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `byte_size` bigint unsigned NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `media_type` varchar(160) NOT NULL,
  `delete_state` varchar(24) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stored_upload` (`created_from_upload_session_id`),
  UNIQUE KEY `uq_stored_identity` (`storage_profile_id`,`container`,`object_key`),
  UNIQUE KEY `uq_stored_workspace_id` (`workspace_id`,`id`),
  KEY `ix_stored_hash` (`workspace_id`,`sha256`),
  KEY `ix_stored_delete` (`workspace_id`,`delete_state`),
  KEY `ix_stored_delete_global` (`delete_state`,`created_at`,`id`),
  KEY `fk_stored_upload_scope` (`workspace_id`,`created_from_upload_session_id`),
  CONSTRAINT `fk_stored_upload_scope` FOREIGN KEY (`workspace_id`, `created_from_upload_session_id`) REFERENCES `upload_session` (`workspace_id`, `id`),
  CONSTRAINT `fk_stored_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_stored_delete` CHECK ((`delete_state` in (_utf8mb4'active',_utf8mb4'deletion_pending',_utf8mb4'deleted',_utf8mb4'missing'))),
  CONSTRAINT `chk_stored_delete_time` CHECK ((((`delete_state` in (_utf8mb4'deleted',_utf8mb4'missing')) and (`deleted_at` is not null) and (`deleted_at` >= `created_at`)) or ((`delete_state` in (_utf8mb4'active',_utf8mb4'deletion_pending')) and (`deleted_at` is null)))),
  CONSTRAINT `chk_stored_identity_hash` CHECK (((`immutable_identity_hash` is null) or regexp_like(`immutable_identity_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_stored_version_identity` CHECK (((`storage_version_id` is null) or (char_length(`storage_version_id`) between 1 and 240)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `upload_session` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `purpose` varchar(40) NOT NULL,
  `actor_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `allocation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `allocation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output_role` varchar(80) DEFAULT NULL,
  `output_index` int unsigned DEFAULT NULL,
  `expected_size` bigint unsigned DEFAULT NULL,
  `expected_media_type` varchar(160) DEFAULT NULL,
  `expected_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `storage_profile_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `compatibility_probe_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `profile_configuration_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `container` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `object_key` varchar(800) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `upload_mode` varchar(32) NOT NULL,
  `write_protection_mode` varchar(32) NOT NULL,
  `provider_upload_id` varchar(240) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `upload_started_at` datetime(3) DEFAULT NULL,
  `seal_manifest_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `seal_started_at` datetime(3) DEFAULT NULL,
  `sealed_identity_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `storage_version_id` varchar(240) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `provider_etag` varchar(240) DEFAULT NULL,
  `sealed_at` datetime(3) DEFAULT NULL,
  `state` varchar(24) NOT NULL,
  `state_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `cleanup_eligible_at` datetime(3) NOT NULL,
  `cleanup_state` varchar(24) NOT NULL,
  `processing_lease_generation` int unsigned NOT NULL DEFAULT '0',
  `processing_lease_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `processing_claimed_at` datetime(3) DEFAULT NULL,
  `processing_lease_expires_at` datetime(3) DEFAULT NULL,
  `verified_size` bigint unsigned DEFAULT NULL,
  `verified_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `detected_media_type` varchar(160) DEFAULT NULL,
  `verification_result_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `verification_completed_at` datetime(3) DEFAULT NULL,
  `verified_at` datetime(3) DEFAULT NULL,
  `verification_profile_version` varchar(80) NOT NULL,
  `committed_stored_object_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cleanup_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cleanup_claimed_at` datetime(3) DEFAULT NULL,
  `cleanup_lease_expires_at` datetime(3) DEFAULT NULL,
  `cleanup_attempts` int unsigned NOT NULL DEFAULT '0',
  `cleanup_retry_at` datetime(3) DEFAULT NULL,
  `cleanup_error_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cleanup_result` varchar(24) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cleaned_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `committed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_upload_object_identity` (`storage_profile_id`,`container`,`object_key`),
  UNIQUE KEY `uq_upload_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_upload_attempt_output` (`attempt_id`,`output_role`,`output_index`),
  UNIQUE KEY `uq_upload_allocation_request` (`workspace_id`,`allocation_request_key`),
  KEY `ix_upload_cleanup` (`workspace_id`,`state`,`cleanup_state`,`cleanup_eligible_at`),
  KEY `fk_upload_committed_object` (`committed_stored_object_id`),
  KEY `ix_upload_attempt_output_lookup` (`workspace_id`,`attempt_id`,`output_role`,`output_index`),
  KEY `ix_upload_cleanup_global` (`cleanup_state`,`cleanup_lease_expires_at`,`cleanup_retry_at`,`cleanup_eligible_at`,`state`,`id`),
  KEY `ix_upload_processing_lease` (`processing_lease_expires_at`,`state`,`id`),
  KEY `fk_upload_probe_scope` (`workspace_id`,`compatibility_probe_id`),
  KEY `fk_upload_committed_object_scope` (`workspace_id`,`committed_stored_object_id`),
  CONSTRAINT `fk_upload_attempt_scope` FOREIGN KEY (`workspace_id`, `attempt_id`) REFERENCES `capability_attempt` (`workspace_id`, `id`),
  CONSTRAINT `fk_upload_committed_object_scope` FOREIGN KEY (`workspace_id`, `committed_stored_object_id`) REFERENCES `stored_object` (`workspace_id`, `id`),
  CONSTRAINT `fk_upload_probe_scope` FOREIGN KEY (`workspace_id`, `compatibility_probe_id`) REFERENCES `storage_compatibility_probe` (`workspace_id`, `id`),
  CONSTRAINT `fk_upload_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_upload_allocation_request` CHECK ((((`allocation_request_key` is null) and (`allocation_request_hash` is null)) or ((`allocation_request_key` is not null) and (char_length(`allocation_request_key`) between 1 and 160) and regexp_like(`allocation_request_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`actor_id` is not null) and (`compatibility_probe_id` is not null) and regexp_like(`profile_configuration_hash`,_ascii'^sha256:[0-9a-f]{64}$')))),
  CONSTRAINT `chk_upload_cleanup` CHECK ((`cleanup_state` in (_utf8mb4'none',_utf8mb4'claimed',_utf8mb4'done',_utf8mb4'failed'))),
  CONSTRAINT `chk_upload_cleanup_deadline` CHECK ((`cleanup_eligible_at` > `expires_at`)),
  CONSTRAINT `chk_upload_cleanup_facts` CHECK ((((`cleanup_state` = _utf8mb4'none') and (`cleanup_token_hash` is null) and (`cleanup_claimed_at` is null) and (`cleanup_lease_expires_at` is null) and (`cleanup_attempts` = 0) and (`cleanup_retry_at` is null) and (`cleanup_error_code` is null) and (`cleanup_result` is null) and (`cleaned_at` is null)) or ((`cleanup_state` = _utf8mb4'claimed') and regexp_like(`cleanup_token_hash`,_ascii'^[0-9a-f]{64}$') and (`cleanup_claimed_at` is not null) and (`cleanup_lease_expires_at` > `cleanup_claimed_at`) and (`cleanup_attempts` >= 1) and (`cleanup_retry_at` is null) and (`cleanup_error_code` is null) and (`cleanup_result` is null) and (`cleaned_at` is null)) or ((`cleanup_state` = _utf8mb4'failed') and regexp_like(`cleanup_token_hash`,_ascii'^[0-9a-f]{64}$') and (`cleanup_claimed_at` is not null) and (`cleanup_lease_expires_at` is null) and (`cleanup_attempts` >= 1) and (`cleanup_retry_at` is not null) and (`cleanup_error_code` is not null) and (`cleanup_result` is null) and (`cleaned_at` is null)) or ((`cleanup_state` = _utf8mb4'done') and regexp_like(`cleanup_token_hash`,_ascii'^[0-9a-f]{64}$') and (`cleanup_claimed_at` is not null) and (`cleanup_lease_expires_at` is null) and (`cleanup_attempts` >= 1) and (`cleanup_retry_at` is null) and (`cleanup_error_code` is null) and (`cleanup_result` in (_ascii'deleted',_ascii'missing')) and (`cleaned_at` is not null)))),
  CONSTRAINT `chk_upload_cleanup_terminal_state` CHECK (((`cleanup_state` = _utf8mb4'none') or (`state` in (_utf8mb4'rejected',_utf8mb4'aborted')))),
  CONSTRAINT `chk_upload_committed_facts` CHECK ((((`state` = _utf8mb4'committed') and (`committed_stored_object_id` is not null) and (`committed_at` is not null) and (`cleanup_state` = _utf8mb4'none')) or ((`state` <> _utf8mb4'committed') and (`committed_stored_object_id` is null) and (`committed_at` is null)))),
  CONSTRAINT `chk_upload_committed_timestamps` CHECK (((`committed_at` is null) or ((`committed_at` >= `created_at`) and (`updated_at` >= `committed_at`)))),
  CONSTRAINT `chk_upload_expected_facts` CHECK ((((`expected_media_type` is null) or (char_length(`expected_media_type`) between 1 and 160)) and ((`expected_sha256` is null) or regexp_like(`expected_sha256`,_ascii'^[0-9a-f]{64}$')))),
  CONSTRAINT `chk_upload_processing_lease` CHECK ((((`processing_lease_token_hash` is null) and (`processing_claimed_at` is null) and (`processing_lease_expires_at` is null)) or (regexp_like(`processing_lease_token_hash`,_ascii'^[0-9a-f]{64}$') and (`processing_claimed_at` is not null) and (`processing_lease_expires_at` > `processing_claimed_at`) and (`state` = _utf8mb4'verifying') and (`cleanup_state` = _utf8mb4'none')))),
  CONSTRAINT `chk_upload_profile_hash` CHECK (((`profile_configuration_hash` is null) or regexp_like(`profile_configuration_hash`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_upload_seal_facts` CHECK (((`allocation_request_key` is null) or ((`state` in (_utf8mb4'verifying',_utf8mb4'verified',_utf8mb4'committed')) and regexp_like(`seal_manifest_hash`,_ascii'^sha256:[0-9a-f]{64}$') and regexp_like(`sealed_identity_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`seal_started_at` is not null) and (`sealed_at` is not null) and (`sealed_at` >= `seal_started_at`)) or (`state` not in (_utf8mb4'verifying',_utf8mb4'verified',_utf8mb4'committed')))),
  CONSTRAINT `chk_upload_state` CHECK ((`state` in (_utf8mb4'open',_utf8mb4'sealing',_utf8mb4'verifying',_utf8mb4'verified',_utf8mb4'committed',_utf8mb4'rejected',_utf8mb4'aborted'))),
  CONSTRAINT `chk_upload_state_reason` CHECK ((((`state` in (_utf8mb4'rejected',_utf8mb4'aborted')) and (`state_reason_code` is not null) and (char_length(`state_reason_code`) between 1 and 120)) or ((`state` not in (_utf8mb4'rejected',_utf8mb4'aborted')) and (`state_reason_code` is null)))),
  CONSTRAINT `chk_upload_state_shape` CHECK (((`allocation_request_key` is null) or ((`state` = _utf8mb4'open') and (`seal_manifest_hash` is null) and (`seal_started_at` is null) and (`sealed_identity_hash` is null) and (`sealed_at` is null) and ((`upload_started_at` is null) or (`upload_started_at` >= `created_at`))) or ((`state` = _utf8mb4'sealing') and (`upload_started_at` is not null) and (`upload_started_at` >= `created_at`) and regexp_like(`seal_manifest_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`seal_started_at` is not null) and (`seal_started_at` >= `upload_started_at`) and (`sealed_identity_hash` is null) and (`sealed_at` is null)) or ((`state` in (_utf8mb4'verifying',_utf8mb4'verified',_utf8mb4'committed')) and (`upload_started_at` is not null) and (`upload_started_at` >= `created_at`)) or (`state` in (_utf8mb4'rejected',_utf8mb4'aborted')))),
  CONSTRAINT `chk_upload_target_shape` CHECK (((`allocation_request_key` is null) or ((char_length(`container`) between 1 and 160) and (char_length(`object_key`) between 1 and 800) and (char_length(`verification_profile_version`) between 1 and 80) and (((`upload_mode` = _utf8mb4'server_stream') and (`write_protection_mode` = _utf8mb4'server_owned')) or ((`upload_mode` = _utf8mb4'single_put') and (`write_protection_mode` in (_utf8mb4'server_owned',_utf8mb4'conditional_create',_utf8mb4'version_bound'))) or ((`upload_mode` = _utf8mb4'multipart') and (`write_protection_mode` = _utf8mb4'multipart_sealed')))))),
  CONSTRAINT `chk_upload_verification_decision` CHECK (((`allocation_request_key` is null) or ((`state` = _utf8mb4'rejected') and regexp_like(`verification_result_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`verification_completed_at` is not null) and (`verified_at` is null)) or (`state` <> _utf8mb4'rejected'))),
  CONSTRAINT `chk_upload_verified` CHECK (((`state` not in (_utf8mb4'verified',_utf8mb4'committed')) or ((`verified_size` is not null) and (`verified_sha256` is not null) and (`detected_media_type` is not null)))),
  CONSTRAINT `chk_upload_verified_digest` CHECK (((`verified_sha256` is null) or regexp_like(`verified_sha256`,_ascii'^[0-9a-f]{64}$'))),
  CONSTRAINT `chk_upload_verified_media_type` CHECK (((`detected_media_type` is null) or (char_length(`detected_media_type`) between 1 and 160))),
  CONSTRAINT `chk_upload_verified_runtime` CHECK (((`state` not in (_utf8mb4'verified',_utf8mb4'committed')) or ((`verified_size` is not null) and regexp_like(`verified_sha256`,_ascii'^[0-9a-f]{64}$') and (`detected_media_type` is not null) and (char_length(`detected_media_type`) between 1 and 160) and ((`allocation_request_key` is null) or (regexp_like(`verification_result_hash`,_ascii'^sha256:[0-9a-f]{64}$') and (`verification_completed_at` is not null) and (`verified_at` is not null) and (`verified_at` = `verification_completed_at`) and (`verified_at` >= `sealed_at`)))))),
  CONSTRAINT `chk_upload_version_bound_identity` CHECK (((`write_protection_mode` <> _utf8mb4'version_bound') or (`state` not in (_utf8mb4'verifying',_utf8mb4'verified',_utf8mb4'committed')) or (`storage_version_id` is not null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `usage_ledger_entry` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_completion_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entry_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `metric_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `value_dimension` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `unit_code` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `numeric_value` decimal(36,12) DEFAULT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `entry_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recording_phase` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `corrects_usage_entry_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `provider_invocation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pricing_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evidence_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observed_at` datetime(3) NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usage_ledger_attempt_entry` (`capability_attempt_id`,`entry_key`),
  UNIQUE KEY `uq_usage_ledger_correction_scope` (`workspace_id`,`capability_attempt_id`,`id`),
  KEY `fk_usage_ledger_completion_scope` (`workspace_id`,`capability_attempt_id`,`attempt_completion_id`),
  KEY `fk_usage_ledger_provider_scope` (`workspace_id`,`capability_attempt_id`,`provider_invocation_id`),
  KEY `ix_usage_ledger_completion` (`attempt_completion_id`,`recorded_at`,`id`),
  KEY `ix_usage_ledger_metric` (`workspace_id`,`metric_key`,`recorded_at`,`id`),
  KEY `ix_usage_ledger_provider` (`provider_invocation_id`,`recorded_at`,`id`),
  KEY `ix_usage_ledger_correction` (`corrects_usage_entry_id`,`recorded_at`,`id`),
  KEY `fk_usage_ledger_correction_scope` (`workspace_id`,`capability_attempt_id`,`corrects_usage_entry_id`),
  CONSTRAINT `fk_usage_ledger_completion_scope` FOREIGN KEY (`workspace_id`, `capability_attempt_id`, `attempt_completion_id`) REFERENCES `attempt_completion` (`workspace_id`, `capability_attempt_id`, `id`),
  CONSTRAINT `fk_usage_ledger_correction_scope` FOREIGN KEY (`workspace_id`, `capability_attempt_id`, `corrects_usage_entry_id`) REFERENCES `usage_ledger_entry` (`workspace_id`, `capability_attempt_id`, `id`),
  CONSTRAINT `fk_usage_ledger_provider_scope` FOREIGN KEY (`workspace_id`, `capability_attempt_id`, `provider_invocation_id`) REFERENCES `provider_invocation` (`workspace_id`, `capability_attempt_id`, `id`),
  CONSTRAINT `fk_usage_ledger_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_usage_ledger_correction` CHECK ((((`entry_kind` in (_ascii'observation',_ascii'unknown')) and (`corrects_usage_entry_id` is null)) or ((`entry_kind` in (_ascii'adjustment',_ascii'resolution')) and (`corrects_usage_entry_id` is not null) and (`corrects_usage_entry_id` <> `id`)))),
  CONSTRAINT `chk_usage_ledger_dimension` CHECK ((((`value_dimension` = _ascii'quantity') and (`unit_code` is not null) and (char_length(`unit_code`) between 1 and 80) and (`currency_code` is null)) or ((`value_dimension` = _ascii'money') and (`unit_code` is null) and (`currency_code` is not null) and regexp_like(`currency_code`,_ascii'^[A-Z]{3}$')))),
  CONSTRAINT `chk_usage_ledger_entry_kind` CHECK ((`entry_kind` in (_ascii'observation',_ascii'unknown',_ascii'adjustment',_ascii'resolution'))),
  CONSTRAINT `chk_usage_ledger_identity` CHECK (((char_length(`entry_key`) between 1 and 160) and (char_length(`metric_key`) between 1 and 160) and regexp_like(`evidence_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_usage_ledger_observation_value` CHECK (((`entry_kind` in (_ascii'unknown',_ascii'adjustment')) or (`numeric_value` >= 0))),
  CONSTRAINT `chk_usage_ledger_operator` CHECK ((((`recording_phase` = _ascii'operator') and (`source_kind` = _ascii'operator')) or ((`recording_phase` <> _ascii'operator') and (`source_kind` <> _ascii'operator')))),
  CONSTRAINT `chk_usage_ledger_phase` CHECK ((((`recording_phase` = _ascii'completion') and (`entry_kind` in (_ascii'observation',_ascii'unknown'))) or (`recording_phase` <> _ascii'completion'))),
  CONSTRAINT `chk_usage_ledger_recording_phase` CHECK ((`recording_phase` in (_ascii'completion',_ascii'reconciliation',_ascii'operator'))),
  CONSTRAINT `chk_usage_ledger_source` CHECK ((`source_kind` in (_ascii'producer_reported',_ascii'provider_reported',_ascii'kanvas_measured',_ascii'kanvas_calculated',_ascii'operator'))),
  CONSTRAINT `chk_usage_ledger_timestamps` CHECK ((`recorded_at` >= `observed_at`)),
  CONSTRAINT `chk_usage_ledger_value` CHECK ((((`entry_kind` = _ascii'unknown') and (`numeric_value` is null)) or ((`entry_kind` <> _ascii'unknown') and (`numeric_value` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_activated_edge` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_node_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_scope_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_node_version` int unsigned NOT NULL,
  `target_node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_node_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_scope_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `activation_kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `switch_decision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `activation_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `activated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_edge` (`workflow_run_id`,`source_node_key`,`source_scope_key`,`target_node_key`,`target_scope_key`),
  KEY `fk_workflow_edge_workspace` (`workspace_id`),
  KEY `fk_workflow_edge_source` (`source_node_run_id`),
  KEY `fk_workflow_edge_target` (`target_node_run_id`),
  KEY `fk_workflow_edge_switch` (`switch_decision_id`),
  KEY `ix_workflow_edge_target` (`workflow_run_id`,`target_node_run_id`,`activated_at`),
  KEY `ix_workflow_edge_source` (`workflow_run_id`,`source_node_run_id`,`activated_at`),
  CONSTRAINT `fk_workflow_edge_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_edge_source` FOREIGN KEY (`source_node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_edge_switch` FOREIGN KEY (`switch_decision_id`) REFERENCES `workflow_switch_decision` (`id`),
  CONSTRAINT `fk_workflow_edge_target` FOREIGN KEY (`target_node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_edge_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_edge_kind` CHECK ((`activation_kind` in (_ascii'entry',_ascii'declared',_ascii'switch',_ascii'map_item'))),
  CONSTRAINT `chk_workflow_edge_source_shape` CHECK ((((`activation_kind` = _ascii'entry') and (`source_node_run_id` is null) and (`source_node_key` = _ascii'__entry__') and (`source_scope_key` = _ascii'root') and (`source_node_version` = 1) and (`switch_decision_id` is null)) or ((`activation_kind` = _ascii'declared') and (`source_node_run_id` is not null) and (`switch_decision_id` is null)) or ((`activation_kind` = _ascii'map_item') and (`source_node_run_id` is not null) and (`switch_decision_id` is null)) or ((`activation_kind` = _ascii'switch') and (`source_node_run_id` is not null) and (`switch_decision_id` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_approval_decision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approval_request_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authorization_decision_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authorization_context` json NOT NULL,
  `authorization_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision` json NOT NULL,
  `decision_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decided_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_decision_request` (`approval_request_id`),
  UNIQUE KEY `uq_workflow_decision_authorization` (`workspace_id`,`authorization_decision_id`),
  CONSTRAINT `fk_workflow_decision_request` FOREIGN KEY (`approval_request_id`) REFERENCES `workflow_approval_request` (`id`),
  CONSTRAINT `fk_workflow_decision_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_approval_request` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `definition_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published_revision',
  `workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `execution_plan_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `node_input` json NOT NULL,
  `node_input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_payload` json NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision_schema` json NOT NULL,
  `decision_schema_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `required_permission` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `authorization_context_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_approval_node` (`node_run_id`),
  UNIQUE KEY `uq_workflow_approval_request_scope` (`workspace_id`,`id`),
  KEY `fk_workflow_approval_run` (`workflow_run_id`),
  KEY `ix_workflow_approval_run` (`workspace_id`,`workflow_run_id`,`created_at`),
  KEY `fk_workflow_approval_revision_v2` (`workflow_revision_id`),
  KEY `fk_workflow_approval_candidate` (`workspace_id`,`publication_candidate_id`),
  CONSTRAINT `fk_workflow_approval_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_approval_node` FOREIGN KEY (`node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_approval_revision_v2` FOREIGN KEY (`workflow_revision_id`) REFERENCES `workflow_revision` (`id`),
  CONSTRAINT `fk_workflow_approval_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_approval_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_approval_definition_ref` CHECK ((((`definition_kind` = _ascii'published_revision') and (`workflow_revision_id` is not null) and (`publication_candidate_id` is null)) or ((`definition_kind` = _ascii'publication_candidate') and (`workflow_revision_id` is null) and (`publication_candidate_id` is not null)))),
  CONSTRAINT `chk_workflow_approval_expiry` CHECK ((`expires_at` > `created_at`)),
  CONSTRAINT `chk_workflow_approval_permission` CHECK ((`required_permission` = _ascii'approval.decide'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_approval_state` (
  `approval_request_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `decided_at` datetime(3) DEFAULT NULL,
  `expired_at` datetime(3) DEFAULT NULL,
  `cancelled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`approval_request_id`),
  KEY `ix_workflow_approval_state_due` (`workspace_id`,`lifecycle_status`,`updated_at`,`approval_request_id`),
  CONSTRAINT `fk_workflow_approval_state_request` FOREIGN KEY (`approval_request_id`) REFERENCES `workflow_approval_request` (`id`),
  CONSTRAINT `fk_workflow_approval_state_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_approval_state_shape` CHECK ((((`lifecycle_status` = _ascii'pending') and (`decided_at` is null) and (`expired_at` is null) and (`cancelled_at` is null)) or ((`lifecycle_status` = _ascii'decided') and (`decided_at` is not null) and (`expired_at` is null) and (`cancelled_at` is null)) or ((`lifecycle_status` = _ascii'expired') and (`decided_at` is null) and (`expired_at` is not null) and (`cancelled_at` is null)) or ((`lifecycle_status` = _ascii'cancelled') and (`decided_at` is null) and (`expired_at` is null) and (`cancelled_at` is not null)))),
  CONSTRAINT `chk_workflow_approval_state_status` CHECK ((`lifecycle_status` in (_ascii'pending',_ascii'decided',_ascii'expired',_ascii'cancelled'))),
  CONSTRAINT `chk_workflow_approval_state_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_capability_cancellation_request` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capability_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_kind` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requested_at` datetime(3) NOT NULL,
  `cancel_deadline_at` datetime(3) NOT NULL,
  `request_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_cap_cancel_capability` (`capability_run_id`),
  KEY `fk_workflow_cap_cancel_run` (`workflow_run_id`),
  KEY `fk_workflow_cap_cancel_attempt` (`capability_attempt_id`),
  KEY `ix_workflow_cap_cancel_run` (`workspace_id`,`workflow_run_id`,`requested_at`,`capability_run_id`),
  CONSTRAINT `fk_workflow_cap_cancel_attempt` FOREIGN KEY (`capability_attempt_id`) REFERENCES `capability_attempt` (`id`),
  CONSTRAINT `fk_workflow_cap_cancel_capability` FOREIGN KEY (`capability_run_id`) REFERENCES `capability_run` (`id`),
  CONSTRAINT `fk_workflow_cap_cancel_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_cap_cancel_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_cap_cancel_deadline` CHECK ((`cancel_deadline_at` >= `requested_at`)),
  CONSTRAINT `chk_workflow_cap_cancel_reason` CHECK (regexp_like(`reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$')),
  CONSTRAINT `chk_workflow_cap_cancel_source` CHECK ((`source_kind` in (_ascii'workflow_deadline',_ascii'map_fail_fast')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_deadline_schedule` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_plan_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_deadline_at` datetime(3) NOT NULL,
  `outbox_event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schedule_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_deadline_run` (`workflow_run_id`),
  UNIQUE KEY `uq_workflow_deadline_outbox` (`outbox_event_id`),
  KEY `ix_workflow_deadline_due` (`workspace_id`,`execution_deadline_at`,`workflow_run_id`),
  CONSTRAINT `fk_workflow_deadline_outbox` FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_event` (`id`),
  CONSTRAINT `fk_workflow_deadline_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_deadline_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_definition` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_key` varchar(160) NOT NULL,
  `display_name` varchar(240) NOT NULL,
  `description` varchar(1000) DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `lifecycle_status` varchar(16) NOT NULL,
  `creation_request_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `creation_request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_definition_key` (`workspace_id`,`workflow_key`),
  UNIQUE KEY `uq_workflow_definition_workspace_id` (`workspace_id`,`id`),
  UNIQUE KEY `uq_workflow_definition_creation_request` (`workspace_id`,`creation_request_key`),
  KEY `fk_workflow_definition_created_by` (`created_by_principal_id`),
  KEY `fk_workflow_definition_updated_by` (`updated_by_principal_id`),
  KEY `ix_workflow_definition_list` (`workspace_id`,`lifecycle_status`,`updated_at`,`id`),
  CONSTRAINT `fk_workflow_definition_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_definition_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_definition_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_definition_creation_request` CHECK ((((`creation_request_key` is null) and (`creation_request_hash` is null)) or ((`creation_request_key` is not null) and (`creation_request_hash` is not null)))),
  CONSTRAINT `chk_workflow_definition_status` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'archived')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_draft` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workflow_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `content_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `derived_from_workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_draft_key` (`workspace_id`,`workflow_key`),
  UNIQUE KEY `uq_workflow_draft_workspace_id` (`workspace_id`,`id`),
  KEY `fk_workflow_draft_derived` (`workspace_id`,`derived_from_workflow_revision_id`),
  KEY `fk_workflow_draft_creator` (`created_by_principal_id`),
  KEY `fk_workflow_draft_updater` (`updated_by_principal_id`),
  KEY `ix_workflow_draft_definition` (`workspace_id`,`workflow_definition_id`,`lifecycle_status`),
  CONSTRAINT `fk_workflow_draft_creator` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_draft_definition` FOREIGN KEY (`workspace_id`, `workflow_definition_id`) REFERENCES `workflow_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_draft_derived` FOREIGN KEY (`workspace_id`, `derived_from_workflow_revision_id`) REFERENCES `workflow_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_draft_updater` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_draft_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_draft_digest` CHECK (regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$')),
  CONSTRAINT `chk_workflow_draft_document` CHECK ((json_type(`content_document`) = _utf8mb4'OBJECT')),
  CONSTRAINT `chk_workflow_draft_schema` CHECK ((`schema_version` >= 1)),
  CONSTRAINT `chk_workflow_draft_status` CHECK ((`lifecycle_status` in (_ascii'active',_ascii'archived'))),
  CONSTRAINT `chk_workflow_draft_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_map_expansion` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coordinator_node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `items` json NOT NULL,
  `items_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_keys` json NOT NULL,
  `scope_keys_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_count` int unsigned NOT NULL,
  `max_items` int unsigned NOT NULL,
  `max_concurrency` int unsigned NOT NULL,
  `failure_mode` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expansion_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_map_coordinator` (`coordinator_node_run_id`),
  UNIQUE KEY `uq_workflow_map_expansion_scope` (`workspace_id`,`id`),
  KEY `fk_workflow_map_run` (`workflow_run_id`),
  KEY `ix_workflow_map_run` (`workspace_id`,`workflow_run_id`,`created_at`),
  CONSTRAINT `fk_workflow_map_coordinator` FOREIGN KEY (`coordinator_node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_map_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_map_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_map_concurrency` CHECK ((`max_concurrency` between 1 and 32)),
  CONSTRAINT `chk_workflow_map_failure_mode` CHECK ((`failure_mode` in (_ascii'collect_all',_ascii'fail_fast'))),
  CONSTRAINT `chk_workflow_map_items` CHECK (((json_type(`items`) = _utf8mb4'ARRAY') and (json_length(`items`) = `item_count`) and (json_type(`scope_keys`) = _utf8mb4'ARRAY') and (json_length(`scope_keys`) = `item_count`) and (`item_count` <= `max_items`) and (`max_items` between 1 and 500)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_map_item` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `map_expansion_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coordinator_node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_index` int unsigned NOT NULL,
  `scope_key` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_value` json NOT NULL,
  `item_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_map_item_index` (`map_expansion_id`,`item_index`),
  UNIQUE KEY `uq_workflow_map_item_node` (`item_node_run_id`),
  UNIQUE KEY `uq_workflow_map_item_scope` (`workflow_run_id`,`coordinator_node_run_id`,`scope_key`),
  KEY `fk_workflow_map_item_workspace` (`workspace_id`),
  KEY `fk_workflow_map_item_coordinator` (`coordinator_node_run_id`),
  CONSTRAINT `fk_workflow_map_item_coordinator` FOREIGN KEY (`coordinator_node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_map_item_expansion` FOREIGN KEY (`map_expansion_id`) REFERENCES `workflow_map_expansion` (`id`),
  CONSTRAINT `fk_workflow_map_item_node` FOREIGN KEY (`item_node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_map_item_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_map_item_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_map_state` (
  `map_expansion_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `next_item_index` int unsigned NOT NULL,
  `active_count` int unsigned NOT NULL,
  `completed_count` int unsigned NOT NULL,
  `failed_count` int unsigned NOT NULL,
  `cancelled_count` int unsigned NOT NULL,
  `skipped_count` int unsigned NOT NULL,
  `stop_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`map_expansion_id`),
  KEY `ix_workflow_map_state_status` (`workspace_id`,`lifecycle_status`,`updated_at`,`map_expansion_id`),
  CONSTRAINT `fk_workflow_map_state_expansion` FOREIGN KEY (`map_expansion_id`) REFERENCES `workflow_map_expansion` (`id`),
  CONSTRAINT `fk_workflow_map_state_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_map_state_reason` CHECK (((`stop_reason_code` is null) or regexp_like(`stop_reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$'))),
  CONSTRAINT `chk_workflow_map_state_status` CHECK ((`lifecycle_status` in (_ascii'expanding',_ascii'waiting',_ascii'completed',_ascii'fail_fast_stopping',_ascii'failed'))),
  CONSTRAINT `chk_workflow_map_state_terminal` CHECK ((((`lifecycle_status` in (_ascii'completed',_ascii'failed')) and (`completed_at` is not null)) or ((`lifecycle_status` not in (_ascii'completed',_ascii'failed')) and (`completed_at` is null)))),
  CONSTRAINT `chk_workflow_map_state_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_output_fact` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `output_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `required` tinyint unsigned NOT NULL,
  `resolution_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `value` json DEFAULT NULL,
  `value_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_run_version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_output_key` (`workflow_run_id`,`output_key`),
  KEY `ix_workflow_output_run` (`workspace_id`,`workflow_run_id`,`created_at`),
  CONSTRAINT `fk_workflow_output_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_output_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_output_reason` CHECK (((`reason_code` is null) or regexp_like(`reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$'))),
  CONSTRAINT `chk_workflow_output_required` CHECK ((`required` in (0,1))),
  CONSTRAINT `chk_workflow_output_shape` CHECK ((((`resolution_status` = _ascii'resolved') and (`value` is not null) and (`value_digest` is not null) and (`reason_code` is null)) or ((`resolution_status` in (_ascii'missing',_ascii'invalid')) and (`value` is null) and (`value_digest` is null) and (`reason_code` is not null)))),
  CONSTRAINT `chk_workflow_output_status` CHECK ((`resolution_status` in (_ascii'resolved',_ascii'missing',_ascii'invalid')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_definition_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `workflow_key` varchar(160) NOT NULL,
  `revision` int unsigned NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `topology` json NOT NULL,
  `input_schema` json NOT NULL,
  `output_schema` json NOT NULL,
  `presentation` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_revision` (`workspace_id`,`workflow_key`,`revision`),
  UNIQUE KEY `uq_workflow_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_workflow_revision_workspace_id` (`workspace_id`,`id`),
  KEY `ix_workflow_revision_definition` (`workspace_id`,`workflow_definition_id`,`revision`),
  CONSTRAINT `fk_workflow_revision_definition` FOREIGN KEY (`workspace_id`, `workflow_definition_id`) REFERENCES `workflow_definition` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_revision_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_revision_status` CHECK ((`lifecycle_status` in (_utf8mb4'draft',_utf8mb4'published',_utf8mb4'deprecated',_utf8mb4'revoked')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_revision_activation` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `runtime_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workflow_revision_id`),
  KEY `fk_workflow_activation_revision` (`workspace_id`,`workflow_revision_id`),
  KEY `fk_workflow_activation_actor` (`updated_by_principal_id`),
  KEY `ix_workflow_activation_status` (`workspace_id`,`runtime_status`,`updated_at`,`workflow_revision_id`),
  CONSTRAINT `fk_workflow_activation_actor` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_activation_revision` FOREIGN KEY (`workspace_id`, `workflow_revision_id`) REFERENCES `workflow_revision` (`workspace_id`, `id`),
  CONSTRAINT `chk_workflow_activation_reason` CHECK ((((`runtime_status` = _ascii'revoked') and (`reason_code` is not null)) or (`runtime_status` in (_ascii'enabled',_ascii'disabled')))),
  CONSTRAINT `chk_workflow_activation_status` CHECK ((`runtime_status` in (_ascii'enabled',_ascii'disabled',_ascii'revoked'))),
  CONSTRAINT `chk_workflow_activation_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_revision_publication` (
  `workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workflow_revision_id`),
  UNIQUE KEY `uq_workflow_publication_candidate` (`workspace_id`,`publication_candidate_id`),
  KEY `fk_workflow_publication_revision` (`workspace_id`,`workflow_revision_id`),
  KEY `fk_workflow_publication_actor` (`published_by_principal_id`),
  CONSTRAINT `fk_workflow_publication_actor` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workflow_publication_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_publication_revision` FOREIGN KEY (`workspace_id`, `workflow_revision_id`) REFERENCES `workflow_revision` (`workspace_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_run` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `definition_kind` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published_revision',
  `workflow_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `publication_candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `brand_kit_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `non_production` tinyint(1) NOT NULL DEFAULT '0',
  `idempotency_key` varchar(160) NOT NULL,
  `request_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) NOT NULL,
  `outcome` varchar(32) DEFAULT NULL,
  `input` json NOT NULL,
  `output` json DEFAULT NULL,
  `output_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `terminal_reason_code` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `execution_deadline_at` datetime(3) NOT NULL,
  `execution_plan_snapshot` json NOT NULL,
  `execution_plan_hash` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `cancel_requested_at` datetime(3) DEFAULT NULL,
  `cancel_requested_by` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cancel_reason_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `cancel_deadline_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_run_idempotency` (`workspace_id`,`idempotency_key`),
  UNIQUE KEY `uq_workflow_run_workspace_id` (`workspace_id`,`id`),
  KEY `ix_workflow_run_status` (`workspace_id`,`lifecycle_status`,`created_at`),
  KEY `ix_workflow_run_reconcile` (`lifecycle_status`,`updated_at`,`id`),
  KEY `ix_workflow_run_cancel` (`lifecycle_status`,`cancel_deadline_at`,`updated_at`,`id`),
  KEY `fk_workflow_run_revision_v2` (`workflow_revision_id`),
  KEY `ix_workflow_run_candidate` (`workspace_id`,`publication_candidate_id`,`created_at`),
  KEY `ix_workflow_run_recent_by_creator` (`workspace_id`,`created_by`,`definition_kind`,`non_production`,`lifecycle_status`,`outcome`,`created_at` DESC,`id` DESC),
  KEY `ix_workflow_run_recent_by_creator_revision` (`workspace_id`,`created_by`,`workflow_revision_id`,`definition_kind`,`non_production`,`lifecycle_status`,`outcome`,`created_at` DESC,`id` DESC),
  KEY `ix_workflow_run_brand_recent` (`workspace_id`,`brand_kit_revision_id`,`created_at`,`id`),
  CONSTRAINT `fk_workflow_run_brand_revision` FOREIGN KEY (`workspace_id`, `brand_kit_revision_id`) REFERENCES `brand_kit_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_run_candidate` FOREIGN KEY (`workspace_id`, `publication_candidate_id`) REFERENCES `publication_candidate` (`workspace_id`, `id`),
  CONSTRAINT `fk_workflow_run_revision_v2` FOREIGN KEY (`workflow_revision_id`) REFERENCES `workflow_revision` (`id`),
  CONSTRAINT `fk_workflow_run_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_run_cancel_facts` CHECK ((((`cancel_requested_at` is null) and (`cancel_requested_by` is null) and (`cancel_reason_code` is null) and (`cancel_deadline_at` is null) and (`lifecycle_status` not in (_utf8mb4'cancelling',_utf8mb4'cancelled'))) or ((`cancel_requested_at` is not null) and (`cancel_requested_by` is not null) and (`cancel_reason_code` is not null) and (`cancel_deadline_at` is not null) and (`cancel_deadline_at` >= `cancel_requested_at`) and (`lifecycle_status` in (_utf8mb4'cancelling',_utf8mb4'cancelled'))))),
  CONSTRAINT `chk_workflow_run_cancel_terminal` CHECK (((`lifecycle_status` <> _utf8mb4'cancelled') or ((`outcome` is null) and (`completed_at` is not null)))),
  CONSTRAINT `chk_workflow_run_definition_ref` CHECK ((((`definition_kind` = _ascii'published_revision') and (`workflow_revision_id` is not null) and (`publication_candidate_id` is null) and (`non_production` = false)) or ((`definition_kind` = _ascii'publication_candidate') and (`workflow_revision_id` is null) and (`publication_candidate_id` is not null) and (`non_production` = true)))),
  CONSTRAINT `chk_workflow_run_execution_deadline` CHECK ((`execution_deadline_at` > `created_at`)),
  CONSTRAINT `chk_workflow_run_outcome` CHECK ((((`lifecycle_status` = _utf8mb4'completed') and (`outcome` in (_utf8mb4'full_success',_utf8mb4'partial_success'))) or ((`lifecycle_status` = _utf8mb4'failed') and (`outcome` = _utf8mb4'no_usable_output')) or ((`lifecycle_status` not in (_utf8mb4'completed',_utf8mb4'failed')) and (`outcome` is null)))),
  CONSTRAINT `chk_workflow_run_output_digest` CHECK ((((`output` is null) and (`output_digest` is null)) or ((`output` is not null) and (`output_digest` is not null)))),
  CONSTRAINT `chk_workflow_run_status` CHECK ((`lifecycle_status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'waiting',_utf8mb4'cancelling',_utf8mb4'completed',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_workflow_run_terminal_reason` CHECK (((`terminal_reason_code` is null) or regexp_like(`terminal_reason_code`,_ascii'^[a-z0-9][a-z0-9._:-]{0,119}$')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workflow_switch_decision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workflow_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `node_run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_value` json NOT NULL,
  `input_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `matched_case_index` smallint unsigned DEFAULT NULL,
  `selected_targets` json NOT NULL,
  `decision_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decided_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_switch_node` (`node_run_id`),
  UNIQUE KEY `uq_workflow_switch_digest` (`workflow_run_id`,`decision_digest`),
  KEY `ix_workflow_switch_run` (`workspace_id`,`workflow_run_id`,`decided_at`),
  CONSTRAINT `fk_workflow_switch_node` FOREIGN KEY (`node_run_id`) REFERENCES `node_run` (`id`),
  CONSTRAINT `fk_workflow_switch_run` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run` (`id`),
  CONSTRAINT `fk_workflow_switch_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workflow_switch_case_index` CHECK (((`matched_case_index` is null) or (`matched_case_index` between 0 and 19))),
  CONSTRAINT `chk_workflow_switch_targets` CHECK (((json_type(`selected_targets`) = _utf8mb4'ARRAY') and (json_length(`selected_targets`) between 0 and 20)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `slug` varchar(80) NOT NULL,
  `name` varchar(160) NOT NULL,
  `status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'setup_required',
  `version` int unsigned NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_slug` (`slug`),
  UNIQUE KEY `uq_workspace_organization_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_workspace_organization_slug` (`organization_id`,`slug`),
  KEY `ix_workspace_organization_status` (`organization_id`,`status`,`id`),
  CONSTRAINT `fk_workspace_organization` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`),
  CONSTRAINT `chk_workspace_authorization_version` CHECK ((`version` >= 1)),
  CONSTRAINT `chk_workspace_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'archived',_ascii'setup_required')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace_agent_model_settings` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `default_canonical_model_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fast_canonical_model_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reasoning_level` varchar(16) NOT NULL DEFAULT 'medium',
  `web_search_mode` varchar(16) NOT NULL DEFAULT 'off',
  `action_confirmation_required` tinyint(1) NOT NULL DEFAULT '0',
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`),
  KEY `fk_workspace_agent_models_default` (`workspace_id`,`default_canonical_model_id`),
  KEY `fk_workspace_agent_models_fast` (`workspace_id`,`fast_canonical_model_id`),
  KEY `fk_workspace_agent_models_updated_by` (`updated_by_principal_id`),
  CONSTRAINT `fk_workspace_agent_models_default` FOREIGN KEY (`workspace_id`, `default_canonical_model_id`) REFERENCES `canonical_model` (`workspace_id`, `id`),
  CONSTRAINT `fk_workspace_agent_models_fast` FOREIGN KEY (`workspace_id`, `fast_canonical_model_id`) REFERENCES `canonical_model` (`workspace_id`, `id`),
  CONSTRAINT `fk_workspace_agent_models_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workspace_agent_models_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workspace_agent_models_version` CHECK ((`version` >= 1)),
  CONSTRAINT `chk_workspace_agent_reasoning_level` CHECK ((`reasoning_level` in (_utf8mb4'off',_utf8mb4'low',_utf8mb4'medium',_utf8mb4'high'))),
  CONSTRAINT `chk_workspace_agent_web_search_mode` CHECK ((`web_search_mode` in (_utf8mb4'off',_utf8mb4'auto',_utf8mb4'required')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace_membership` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `organization_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_membership_principal` (`workspace_id`,`principal_id`),
  UNIQUE KEY `uq_workspace_membership_scope_id` (`workspace_id`,`id`),
  KEY `fk_workspace_membership_workspace` (`organization_id`,`workspace_id`),
  KEY `ix_workspace_membership_owner` (`workspace_id`,`status`,`role`,`id`),
  KEY `ix_workspace_membership_principal` (`principal_id`,`status`,`workspace_id`),
  CONSTRAINT `fk_workspace_membership_human` FOREIGN KEY (`principal_id`) REFERENCES `human_principal` (`principal_id`),
  CONSTRAINT `fk_workspace_membership_workspace` FOREIGN KEY (`organization_id`, `workspace_id`) REFERENCES `workspace` (`organization_id`, `id`),
  CONSTRAINT `chk_workspace_membership_role` CHECK ((`role` in (_utf8mb4'owner',_utf8mb4'admin',_utf8mb4'editor',_utf8mb4'operator',_utf8mb4'reviewer',_utf8mb4'viewer'))),
  CONSTRAINT `chk_workspace_membership_status` CHECK ((`status` in (_ascii'active',_ascii'suspended',_ascii'revoked'))),
  CONSTRAINT `chk_workspace_membership_version` CHECK (((`version` >= 1) and (`updated_at` >= `created_at`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace_policy_binding` (
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `active_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` int unsigned NOT NULL,
  `updated_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`workspace_id`),
  KEY `fk_workspace_policy_binding_revision` (`workspace_id`,`active_revision_id`),
  KEY `fk_workspace_policy_binding_updated_by` (`updated_by_principal_id`),
  CONSTRAINT `fk_workspace_policy_binding_revision` FOREIGN KEY (`workspace_id`, `active_revision_id`) REFERENCES `workspace_policy_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_workspace_policy_binding_updated_by` FOREIGN KEY (`updated_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workspace_policy_binding_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workspace_policy_binding_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workspace_policy_revision` (
  `id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workspace_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` int unsigned NOT NULL,
  `schema_version` smallint unsigned NOT NULL,
  `policy_document` json NOT NULL,
  `canonical_digest` char(71) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lifecycle_status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supersedes_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `published_by_principal_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `published_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_policy_revision` (`workspace_id`,`revision`),
  UNIQUE KEY `uq_workspace_policy_digest` (`workspace_id`,`canonical_digest`),
  UNIQUE KEY `uq_workspace_policy_workspace_id` (`workspace_id`,`id`),
  KEY `fk_workspace_policy_supersedes` (`workspace_id`,`supersedes_revision_id`),
  KEY `fk_workspace_policy_created_by` (`created_by_principal_id`),
  KEY `fk_workspace_policy_published_by` (`published_by_principal_id`),
  CONSTRAINT `fk_workspace_policy_created_by` FOREIGN KEY (`created_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workspace_policy_published_by` FOREIGN KEY (`published_by_principal_id`) REFERENCES `principal` (`id`),
  CONSTRAINT `fk_workspace_policy_supersedes` FOREIGN KEY (`workspace_id`, `supersedes_revision_id`) REFERENCES `workspace_policy_revision` (`workspace_id`, `id`),
  CONSTRAINT `fk_workspace_policy_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`),
  CONSTRAINT `chk_workspace_policy_document` CHECK (((`revision` >= 1) and (`schema_version` >= 1) and (json_type(`policy_document`) = _utf8mb4'OBJECT') and regexp_like(`canonical_digest`,_ascii'^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT `chk_workspace_policy_lifecycle` CHECK ((`lifecycle_status` in (_ascii'published',_ascii'deprecated',_ascii'revoked'))),
  CONSTRAINT `chk_workspace_policy_time` CHECK ((`published_at` >= `created_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER `trg_artifact_content_immutable` BEFORE UPDATE ON `artifact` FOR EACH ROW BEGIN
  IF OLD.availability_status = 'available'
     AND (
       NOT (NEW.stored_object_id <=> OLD.stored_object_id)
       OR NOT (NEW.structured_content <=> OLD.structured_content)
       OR NEW.content_digest <> OLD.content_digest
       OR NEW.artifact_type <> OLD.artifact_type
       OR NOT (NEW.metadata <=> OLD.metadata)
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'available artifact content is immutable';
  END IF;
  IF NOT (
       (OLD.availability_status = 'staging'
        AND NEW.availability_status IN (
          'staging',
          'quarantined',
          'available',
          'rejected',
          'expired'
        ))
       OR (OLD.availability_status = 'quarantined'
           AND NEW.availability_status IN (
             'quarantined',
             'available',
             'rejected',
             'expired'
           ))
       OR (OLD.availability_status = 'available'
           AND NEW.availability_status IN ('available', 'expired'))
       OR (OLD.availability_status = 'rejected'
           AND NEW.availability_status IN ('rejected', 'expired'))
       OR (OLD.availability_status = 'expired'
           AND NEW.availability_status = 'expired')
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'artifact availability transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_artifact_edge_no_delete` BEFORE DELETE ON `artifact_edge` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'artifact_edge is append-only';

CREATE TRIGGER `trg_artifact_edge_no_update` BEFORE UPDATE ON `artifact_edge` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'artifact_edge is append-only';

CREATE TRIGGER `trg_artifact_reference_no_delete` BEFORE DELETE ON `artifact_reference` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'artifact_reference is append-only'
;

CREATE TRIGGER `trg_artifact_reference_no_update` BEFORE UPDATE ON `artifact_reference` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'artifact_reference is append-only';

CREATE TRIGGER `trg_artifact_representation_source_expired` AFTER UPDATE ON `artifact` FOR EACH ROW BEGIN
  IF OLD.availability_status <> 'expired'
     AND NEW.availability_status = 'expired'
  THEN
    UPDATE artifact_representation
       SET state = 'deletion_pending',
           cleanup_retry_at = NULL,
           cleanup_error_code = NULL
     WHERE workspace_id = NEW.workspace_id
       AND source_artifact_id = NEW.id
       AND state = 'available';
  END IF;
END;

CREATE TRIGGER `trg_audit_event_no_delete` BEFORE DELETE ON `audit_event` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'audit_event is append-only'
;

CREATE TRIGGER `trg_audit_event_no_update` BEFORE UPDATE ON `audit_event` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'audit_event is append-only';

CREATE TRIGGER `trg_budget_account_no_delete` BEFORE DELETE ON `budget_account` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'budget_account uses lifecycle tombstones';

CREATE TRIGGER `trg_budget_ledger_entry_no_delete` BEFORE DELETE ON `budget_ledger_entry` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'budget_ledger_entry is append-only'
;

CREATE TRIGGER `trg_budget_ledger_entry_no_update` BEFORE UPDATE ON `budget_ledger_entry` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'budget_ledger_entry is append-only';

CREATE TRIGGER `trg_budget_reservation_no_delete` BEFORE DELETE ON `budget_reservation` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'budget_reservation is durable';

CREATE TRIGGER `trg_canonical_model_identity_immutable` BEFORE UPDATE ON `canonical_model` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.slug <> OLD.slug
     OR NEW.source_kind <> OLD.source_kind
     OR NOT (NEW.source_reference <=> OLD.source_reference)
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'canonical model identity is immutable';
  END IF;
  IF OLD.lifecycle_status = 'revoked'
     AND NEW.lifecycle_status <> 'revoked'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'canonical model revoke is permanent';
  END IF;
END;

CREATE TRIGGER `trg_canonical_model_no_delete` BEFORE DELETE ON `canonical_model` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'canonical models use lifecycle tombstones';

CREATE TRIGGER `trg_canvas_draft_reference_no_delete` BEFORE DELETE ON `canvas_draft_artifact_reference` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'canvas draft Artifact references cannot be deleted'
;

CREATE TRIGGER `trg_canvas_draft_reference_no_update` BEFORE UPDATE ON `canvas_draft_artifact_reference` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'canvas draft Artifact references are append-only';

CREATE TRIGGER `trg_capability_run_update` BEFORE UPDATE ON `capability_run` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NOT (NEW.node_run_id <=> OLD.node_run_id)
     OR NEW.invocation_kind <> OLD.invocation_kind
     OR NEW.invocation_reference_id <> OLD.invocation_reference_id
     OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
     OR NOT (NEW.request_hash <=> OLD.request_hash)
     OR NEW.created_by <> OLD.created_by
     OR NOT (NEW.input <=> OLD.input)
     OR NEW.input_digest <> OLD.input_digest
     OR NOT (NEW.route_snapshot <=> OLD.route_snapshot)
     OR NEW.route_snapshot_hash <> OLD.route_snapshot_hash
     OR NEW.execution_deadline_at <> OLD.execution_deadline_at
     OR NEW.contract_revision_id <> OLD.contract_revision_id
     OR NEW.binding_id <> OLD.binding_id
     OR NEW.implementation_revision_id <> OLD.implementation_revision_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'capability_run execution identity is immutable';
  END IF;
END;

CREATE TRIGGER `trg_cap_contract_revision_delete` BEFORE DELETE ON `capability_contract_revision` FOR EACH ROW BEGIN
  IF OLD.lifecycle_status <> 'draft'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published capability_contract_revision cannot be deleted';
  END IF;
END;

CREATE TRIGGER `trg_cap_contract_revision_update` BEFORE UPDATE ON `capability_contract_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.contract_key <> OLD.contract_key
     OR NEW.revision <> OLD.revision
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'capability_contract_revision identity is immutable';
  END IF;
  IF OLD.lifecycle_status IN ('published', 'deprecated', 'revoked')
     AND (
       NEW.canonical_digest <> OLD.canonical_digest
       OR NOT (NEW.input_schema <=> OLD.input_schema)
       OR NOT (NEW.output_schema <=> OLD.output_schema)
       OR NOT (NEW.presentation <=> OLD.presentation)
       OR NEW.idempotency_mode <> OLD.idempotency_mode
       OR NOT (NEW.supported_invokers <=> OLD.supported_invokers)
       OR NOT (NEW.published_at <=> OLD.published_at)
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published capability_contract_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (
      OLD.lifecycle_status = 'draft'
      AND NEW.lifecycle_status IN ('published', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'published'
      AND NEW.lifecycle_status IN ('deprecated', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'deprecated'
      AND NEW.lifecycle_status = 'revoked'
    )
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'capability_contract_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_cap_declaration_revision_delete` BEFORE DELETE ON `capability_declaration_revision` FOR EACH ROW BEGIN
  IF OLD.lifecycle_status <> 'draft'
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published capability_declaration_revision cannot be deleted';
  END IF;
END;

CREATE TRIGGER `trg_cap_declaration_revision_update` BEFORE UPDATE ON `capability_declaration_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.capability_definition_id <> OLD.capability_definition_id
     OR NEW.contract_revision_id <> OLD.contract_revision_id
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NOT (NEW.declaration <=> OLD.declaration)
     OR NEW.publication_request_key <> OLD.publication_request_key
     OR NEW.publication_request_hash <> OLD.publication_request_hash
     OR NEW.created_at <> OLD.created_at
     OR NOT (NEW.published_at <=> OLD.published_at)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capability_declaration_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (OLD.lifecycle_status = 'draft' AND NEW.lifecycle_status IN ('published', 'revoked'))
    OR (OLD.lifecycle_status = 'published' AND NEW.lifecycle_status IN ('deprecated', 'revoked'))
    OR (OLD.lifecycle_status = 'deprecated' AND NEW.lifecycle_status = 'revoked')
  )
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capability_declaration_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_cap_impl_revision_delete` BEFORE DELETE ON `capability_implementation_revision` FOR EACH ROW BEGIN
  IF OLD.lifecycle_status <> 'draft'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published capability_implementation_revision cannot be deleted';
  END IF;
END;

CREATE TRIGGER `trg_cap_impl_revision_update` BEFORE UPDATE ON `capability_implementation_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.implementation_key <> OLD.implementation_key
     OR NEW.revision <> OLD.revision
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'capability_implementation_revision identity is immutable';
  END IF;
  IF OLD.lifecycle_status IN ('published', 'deprecated', 'revoked')
     AND (
       NEW.execution_target <> OLD.execution_target
       OR NOT (NEW.display_name <=> OLD.display_name)
       OR NOT (NEW.description <=> OLD.description)
       OR NEW.adapter_key <> OLD.adapter_key
       OR NEW.contract_revision_id <> OLD.contract_revision_id
       OR NEW.runtime_adapter_revision_id <> OLD.runtime_adapter_revision_id
       OR NEW.source_kind <> OLD.source_kind
       OR NOT (NEW.source_reference <=> OLD.source_reference)
       OR NEW.canonical_digest <> OLD.canonical_digest
       OR NEW.publication_request_key <> OLD.publication_request_key
       OR NEW.publication_request_hash <> OLD.publication_request_hash
       OR NOT (NEW.configuration <=> OLD.configuration)
       OR NOT (NEW.input_mapping <=> OLD.input_mapping)
       OR NEW.input_mapping_digest <> OLD.input_mapping_digest
       OR NOT (NEW.compiled_input_mapping <=> OLD.compiled_input_mapping)
       OR NOT (NEW.output_mapping <=> OLD.output_mapping)
       OR NEW.output_mapping_digest <> OLD.output_mapping_digest
       OR NOT (NEW.compiled_output_mapping <=> OLD.compiled_output_mapping)
       OR NOT (NEW.fixture_suite <=> OLD.fixture_suite)
       OR NOT (NEW.published_at <=> OLD.published_at)
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published capability_implementation_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (
      OLD.lifecycle_status = 'draft'
      AND NEW.lifecycle_status IN ('published', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'published'
      AND NEW.lifecycle_status IN ('deprecated', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'deprecated'
      AND NEW.lifecycle_status = 'revoked'
    )
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'capability_implementation_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_credential_identity_immutable` BEFORE UPDATE ON `credential` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.provider_endpoint_id <> OLD.provider_endpoint_id
     OR NEW.provider_kind <> OLD.provider_kind
     OR NEW.authority_digest <> OLD.authority_digest
     OR NEW.billing_identity_digest <> OLD.billing_identity_digest
     OR NEW.egress_identity_digest <> OLD.egress_identity_digest
     OR NEW.identity_digest <> OLD.identity_digest
     OR NEW.identity_epoch <> OLD.identity_epoch
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'credential identity is immutable';
  END IF;
  IF OLD.lifecycle_status IN ('revoked', 'replaced')
     AND NEW.lifecycle_status = 'active'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'credential terminal state cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_credential_no_delete` BEFORE DELETE ON `credential` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'credential uses lifecycle tombstones';

CREATE TRIGGER `trg_instance_policy_revision_no_delete` BEFORE DELETE ON `instance_policy_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'instance_policy_revision is immutable';

CREATE TRIGGER `trg_instance_policy_revision_no_update` BEFORE UPDATE ON `instance_policy_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NOT (NEW.policy_document <=> OLD.policy_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NOT (
       NEW.supersedes_revision_id
       <=> OLD.supersedes_revision_id
     )
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id
        <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'instance_policy_revision content is immutable';
  END IF;
  IF (OLD.lifecycle_status = 'revoked'
      AND NEW.lifecycle_status <> 'revoked')
     OR (OLD.lifecycle_status = 'deprecated'
         AND NEW.lifecycle_status = 'published')
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'instance_policy_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_model_deployment_identity_immutable` BEFORE UPDATE ON `model_deployment` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.provider_endpoint_id <> OLD.provider_endpoint_id
     OR (OLD.provider_model_record_id IS NOT NULL
         AND NOT (
           NEW.provider_model_record_id <=> OLD.provider_model_record_id
         ))
     OR NEW.model_profile_revision_id <> OLD.model_profile_revision_id
     OR NEW.deployment_key <> OLD.deployment_key
     OR NEW.provider_model_id <> OLD.provider_model_id
     OR NEW.generation <> OLD.generation
     OR NOT (
       NEW.supersedes_model_deployment_id
         <=> OLD.supersedes_model_deployment_id
     )
     OR NEW.deployment_digest <> OLD.deployment_digest
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'model_deployment identity is immutable';
  END IF;
  IF OLD.lifecycle_status = 'revoked'
     AND NEW.lifecycle_status <> 'revoked'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'model_deployment revoke is permanent';
  END IF;
  IF OLD.lifecycle_status = 'superseded'
     AND NEW.lifecycle_status <> 'superseded'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'model_deployment supersession is permanent';
  END IF;
END;

CREATE TRIGGER `trg_model_deployment_no_delete` BEFORE DELETE ON `model_deployment` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'model_deployment uses lifecycle tombstones';

CREATE TRIGGER `trg_model_profile_revision_no_delete` BEFORE DELETE ON `model_profile_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'model_profile_revision is immutable';

CREATE TRIGGER `trg_model_profile_revision_no_update` BEFORE UPDATE ON `model_profile_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR (OLD.canonical_model_id IS NOT NULL
         AND NOT (NEW.canonical_model_id <=> OLD.canonical_model_id))
     OR NEW.profile_key <> OLD.profile_key
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NOT (NEW.profile_document <=> OLD.profile_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'model_profile_revision content is immutable';
  END IF;
  IF (OLD.lifecycle_status = 'revoked'
      AND NEW.lifecycle_status <> 'revoked')
     OR (OLD.lifecycle_status = 'deprecated'
         AND NEW.lifecycle_status = 'published')
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'model_profile_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_model_reference_snapshot_no_delete` BEFORE DELETE ON `model_reference_snapshot` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'model reference snapshots are append-only';
END;

CREATE TRIGGER `trg_model_reference_snapshot_no_update` BEFORE UPDATE ON `model_reference_snapshot` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'model reference snapshots are immutable';
END;

CREATE TRIGGER `trg_model_resource_revision_delete` BEFORE DELETE ON `model_resource_revision` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published model_resource_revision cannot be deleted';
END;

CREATE TRIGGER `trg_model_resource_revision_update` BEFORE UPDATE ON `model_resource_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.model_resource_id <> OLD.model_resource_id
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NEW.display_name <> OLD.display_name
     OR NOT (NEW.description <=> OLD.description)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NOT (NEW.manifest <=> OLD.manifest)
     OR NEW.publication_request_key <> OLD.publication_request_key
     OR NEW.publication_request_hash <> OLD.publication_request_hash
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'model_resource_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (OLD.lifecycle_status = 'published' AND NEW.lifecycle_status IN ('deprecated', 'revoked'))
    OR (OLD.lifecycle_status = 'deprecated' AND NEW.lifecycle_status = 'revoked')
  )
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'model_resource_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_pricing_revision_no_delete` BEFORE DELETE ON `pricing_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'pricing_revision is immutable';

CREATE TRIGGER `trg_pricing_revision_no_update` BEFORE UPDATE ON `pricing_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.provider_endpoint_id <> OLD.provider_endpoint_id
     OR NOT (
       NEW.model_deployment_id
       <=> OLD.model_deployment_id
     )
     OR NEW.pricing_key <> OLD.pricing_key
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NEW.currency_code <> OLD.currency_code
     OR NOT (NEW.pricing_document <=> OLD.pricing_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NEW.source_kind <> OLD.source_kind
     OR NEW.verified_at <> OLD.verified_at
     OR NEW.effective_at <> OLD.effective_at
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id
        <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pricing_revision content is immutable';
  END IF;
  IF (OLD.lifecycle_status = 'revoked'
      AND NEW.lifecycle_status <> 'revoked')
     OR (OLD.lifecycle_status = 'deprecated'
         AND NEW.lifecycle_status = 'published')
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pricing_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_provider_endpoint_identity_immutable` BEFORE UPDATE ON `provider_endpoint` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.adapter_kind <> OLD.adapter_kind
     OR NEW.preset_kind <> OLD.preset_kind
     OR NEW.base_url <> OLD.base_url
     OR NEW.canonical_origin <> OLD.canonical_origin
     OR NEW.base_url_digest <> OLD.base_url_digest
     OR NEW.region_code <> OLD.region_code
     OR NOT (NEW.network_policy <=> OLD.network_policy)
     OR NOT (NEW.data_policy <=> OLD.data_policy)
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'provider_endpoint identity is immutable';
  END IF;
  IF OLD.lifecycle_status = 'revoked'
     AND NEW.lifecycle_status <> 'revoked'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'provider_endpoint revoke is permanent';
  END IF;
END;

CREATE TRIGGER `trg_provider_endpoint_no_delete` BEFORE DELETE ON `provider_endpoint` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'provider_endpoint uses lifecycle tombstones';

CREATE TRIGGER `trg_provider_invocation_request_snapshots_immutable` BEFORE UPDATE ON `provider_invocation` FOR EACH ROW BEGIN
  IF (
    OLD.parameter_resolution_snapshot IS NOT NULL
    OR OLD.parameter_resolution_digest IS NOT NULL
  ) AND (
    NOT (
      NEW.parameter_resolution_snapshot
        <=> OLD.parameter_resolution_snapshot
    )
    OR NOT (
      NEW.parameter_resolution_digest
        <=> OLD.parameter_resolution_digest
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT =
        'provider invocation parameter resolution snapshot is immutable';
  END IF;

  IF (
    OLD.prepared_request_snapshot IS NOT NULL
    OR OLD.prepared_request_digest IS NOT NULL
  ) AND (
    NOT (
      NEW.prepared_request_snapshot
        <=> OLD.prepared_request_snapshot
    )
    OR NOT (
      NEW.prepared_request_digest
        <=> OLD.prepared_request_digest
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT =
        'provider invocation prepared request snapshot is immutable';
  END IF;

  IF (
    OLD.submission_started_at IS NULL
    AND NEW.submission_started_at IS NOT NULL
    AND OLD.prepared_request_snapshot IS NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT =
        'provider request must be prepared before submission starts';
  END IF;

  IF (
    OLD.submission_started_at IS NOT NULL
    AND OLD.prepared_request_snapshot IS NULL
    AND NEW.prepared_request_snapshot IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT =
        'prepared request cannot be recorded after submission started';
  END IF;
END;

CREATE TRIGGER `trg_provider_model_catalog_immutable` BEFORE UPDATE ON `provider_model_catalog_snapshot` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'provider model catalog snapshots are immutable';
END;

CREATE TRIGGER `trg_provider_model_catalog_no_delete` BEFORE DELETE ON `provider_model_catalog_snapshot` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'provider model catalog snapshots are append-only';
END;

CREATE TRIGGER `trg_provider_model_identity_immutable` BEFORE UPDATE ON `provider_model` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.provider_setting_id <> OLD.provider_setting_id
     OR NEW.upstream_model_id <> OLD.upstream_model_id
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'provider model identity is immutable';
  END IF;
  IF OLD.lifecycle_status IN ('active', 'disabled', 'removed')
     AND NOT (NEW.canonical_model_id <=> OLD.canonical_model_id)
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published provider model mapping is immutable';
  END IF;
  IF OLD.lifecycle_status = 'removed'
     AND NEW.lifecycle_status <> 'removed'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'provider model removal is permanent';
  END IF;
END;

CREATE TRIGGER `trg_provider_model_no_delete` BEFORE DELETE ON `provider_model` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'provider models use lifecycle tombstones'
;

CREATE TRIGGER `trg_provider_setting_identity_immutable` BEFORE UPDATE ON `provider_setting` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.provider_endpoint_id <> OLD.provider_endpoint_id
     OR NEW.credential_id <> OLD.credential_id
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.request_digest <> OLD.request_digest
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'provider_setting identity is immutable';
  END IF;
END;

CREATE TRIGGER `trg_provider_setting_no_delete` BEFORE DELETE ON `provider_setting` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'provider_setting uses endpoint lifecycle tombstones';
END;

CREATE TRIGGER `trg_provider_setting_operation_immutable` BEFORE UPDATE ON `provider_setting_operation` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'provider_setting_operation is immutable';
END;

CREATE TRIGGER `trg_provider_setting_operation_no_delete` BEFORE DELETE ON `provider_setting_operation` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'provider_setting_operation is append-only';
END;

CREATE TRIGGER `trg_publication_candidate_no_delete` BEFORE DELETE ON `publication_candidate` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_candidate cannot be deleted';

CREATE TRIGGER `trg_publication_candidate_no_update` BEFORE UPDATE ON `publication_candidate` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_candidate is immutable';

CREATE TRIGGER `trg_publication_check_no_delete` BEFORE DELETE ON `publication_check` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_check cannot be deleted';

CREATE TRIGGER `trg_publication_check_no_update` BEFORE UPDATE ON `publication_check` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_check is immutable';

CREATE TRIGGER `trg_publication_review_no_delete` BEFORE DELETE ON `publication_review_decision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_review_decision cannot be deleted';

CREATE TRIGGER `trg_publication_review_no_update` BEFORE UPDATE ON `publication_review_decision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'publication_review_decision is immutable';

CREATE TRIGGER `trg_route_policy_revision_no_delete` BEFORE DELETE ON `route_policy_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'route_policy_revision is immutable';

CREATE TRIGGER `trg_route_policy_revision_no_update` BEFORE UPDATE ON `route_policy_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.route_key <> OLD.route_key
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NOT (NEW.route_document <=> OLD.route_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id
        <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'route_policy_revision content is immutable';
  END IF;
  IF (OLD.lifecycle_status = 'revoked'
      AND NEW.lifecycle_status <> 'revoked')
     OR (OLD.lifecycle_status = 'deprecated'
         AND NEW.lifecycle_status = 'published')
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'route_policy_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_runtime_adapter_revision_delete` BEFORE DELETE ON `runtime_adapter_revision` FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'runtime_adapter_revision cannot be deleted';
END;

CREATE TRIGGER `trg_runtime_adapter_revision_update` BEFORE UPDATE ON `runtime_adapter_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.runtime_adapter_definition_id <> OLD.runtime_adapter_definition_id
     OR NEW.revision <> OLD.revision
     OR NEW.execution_target <> OLD.execution_target
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NOT (NEW.document <=> OLD.document)
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'runtime_adapter_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (OLD.lifecycle_status = 'published' AND NEW.lifecycle_status IN ('deprecated', 'revoked'))
    OR (OLD.lifecycle_status = 'deprecated' AND NEW.lifecycle_status = 'revoked')
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'runtime_adapter_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_secret_version_material_immutable` BEFORE UPDATE ON `secret_version` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.credential_id <> OLD.credential_id
     OR NEW.version <> OLD.version
     OR NEW.material_generation <> OLD.material_generation
     OR NEW.source_kind <> OLD.source_kind
     OR NEW.aad_digest <> OLD.aad_digest
     OR NEW.material_fingerprint <> OLD.material_fingerprint
     OR NEW.format_version <> OLD.format_version
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'secret_version identity is immutable';
  END IF;
  IF NEW.lifecycle_status <> 'destroyed'
     AND (
       NOT (
         NEW.material_ciphertext_base64
         <=> OLD.material_ciphertext_base64
       )
       OR NOT (
         NEW.material_nonce_base64
         <=> OLD.material_nonce_base64
       )
       OR NOT (
         NEW.material_auth_tag_base64
         <=> OLD.material_auth_tag_base64
       )
       OR NOT (
         NEW.wrapped_dek_base64
         <=> OLD.wrapped_dek_base64
       )
       OR NOT (
         NEW.wrap_nonce_base64
         <=> OLD.wrap_nonce_base64
       )
       OR NOT (
         NEW.wrap_auth_tag_base64
         <=> OLD.wrap_auth_tag_base64
       )
       OR NOT (NEW.kek_version <=> OLD.kek_version)
       OR NOT (
         NEW.deployment_reference
         <=> OLD.deployment_reference
       )
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'secret_version material is immutable';
  END IF;
  IF NEW.lifecycle_status = 'destroyed'
     AND (
       NEW.material_ciphertext_base64 IS NOT NULL
       OR NEW.material_nonce_base64 IS NOT NULL
       OR NEW.material_auth_tag_base64 IS NOT NULL
       OR NEW.wrapped_dek_base64 IS NOT NULL
       OR NEW.wrap_nonce_base64 IS NOT NULL
       OR NEW.wrap_auth_tag_base64 IS NOT NULL
       OR NEW.kek_version IS NOT NULL
       OR NEW.deployment_reference IS NOT NULL
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'destroyed secret_version must erase material';
  END IF;
  IF (OLD.lifecycle_status IN ('retired', 'revoked')
      AND NEW.lifecycle_status IN (
        'verified',
        'active',
        'draining'
      ))
     OR (
       OLD.lifecycle_status = 'destroyed'
       AND NEW.lifecycle_status <> 'destroyed'
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'secret_version terminal state cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_secret_version_no_delete` BEFORE DELETE ON `secret_version` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'secret_version uses destroyed tombstones';

CREATE TRIGGER `trg_skill_activation_no_delete` BEFORE DELETE ON `skill_revision_activation` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision_activation cannot be deleted'
;

CREATE TRIGGER `trg_skill_activation_update` BEFORE UPDATE ON `skill_revision_activation` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.skill_revision_id <> OLD.skill_revision_id
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_revision_activation identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.updated_at < OLD.updated_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_revision_activation must advance CAS version';
  END IF;
  IF OLD.runtime_status = 'revoked'
     AND NEW.runtime_status <> 'revoked'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'revoked skill_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_skill_draft_no_delete` BEFORE DELETE ON `skill_draft` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_draft cannot be deleted';

CREATE TRIGGER `trg_skill_draft_update` BEFORE UPDATE ON `skill_draft` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.skill_key <> OLD.skill_key
     OR NOT (
       NEW.derived_from_skill_revision_id
       <=> OLD.derived_from_skill_revision_id
     )
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_draft identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.updated_at < OLD.updated_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_draft update must advance CAS version';
  END IF;
  IF OLD.lifecycle_status = 'archived'
     AND NEW.lifecycle_status <> 'archived'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archived skill_draft cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_skill_entrypoint_no_delete` BEFORE DELETE ON `skill_revision_workflow_entrypoint` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision_workflow_entrypoint cannot be deleted';

CREATE TRIGGER `trg_skill_entrypoint_no_update` BEFORE UPDATE ON `skill_revision_workflow_entrypoint` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision_workflow_entrypoint is immutable';

CREATE TRIGGER `trg_skill_import_no_delete` BEFORE DELETE ON `skill_package_import` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_package_import cannot be deleted';

CREATE TRIGGER `trg_skill_import_update` BEFORE UPDATE ON `skill_package_import` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.source_stored_object_id <> OLD.source_stored_object_id
     OR NEW.raw_archive_sha256 <> OLD.raw_archive_sha256
     OR NEW.parser_profile_version <> OLD.parser_profile_version
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_package_import identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.updated_at < OLD.updated_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_package_import must advance CAS version';
  END IF;
  IF NOT (
    (OLD.state = 'quarantined'
      AND NEW.state IN ('validated', 'rejected'))
    OR (OLD.state = 'validated'
      AND NEW.state IN ('draft_adopted', 'rejected'))
    OR (OLD.state = 'draft_adopted'
      AND NEW.state = 'candidate_linked')
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_package_import transition is invalid';
  END IF;
  IF OLD.inventory_summary IS NOT NULL
     AND (
       NOT (NEW.inventory_summary <=> OLD.inventory_summary)
       OR NOT (NEW.inventory_digest <=> OLD.inventory_digest)
       OR NOT (
         NEW.logical_package_digest
         <=> OLD.logical_package_digest
       )
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_package_import inventory is immutable';
  END IF;
  IF OLD.adopted_skill_draft_id IS NOT NULL
     AND NOT (
       NEW.adopted_skill_draft_id
       <=> OLD.adopted_skill_draft_id
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_package_import Draft link is immutable';
  END IF;
END;

CREATE TRIGGER `trg_skill_resource_no_delete` BEFORE DELETE ON `skill_revision_resource` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision_resource cannot be deleted';

CREATE TRIGGER `trg_skill_resource_no_update` BEFORE UPDATE ON `skill_revision_resource` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision_resource is immutable';

CREATE TRIGGER `trg_skill_revision_no_delete` BEFORE DELETE ON `skill_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'skill_revision cannot be deleted';

CREATE TRIGGER `trg_skill_revision_update` BEFORE UPDATE ON `skill_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.skill_key <> OLD.skill_key
     OR NEW.revision <> OLD.revision
     OR NEW.publication_candidate_id
        <> OLD.publication_candidate_id
     OR NEW.schema_version <> OLD.schema_version
     OR NOT (NEW.manifest_document <=> OLD.manifest_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NEW.package_digest <> OLD.package_digest
     OR NEW.parser_profile_version <> OLD.parser_profile_version
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id
        <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (
      OLD.lifecycle_status = 'published'
      AND NEW.lifecycle_status = 'deprecated'
    )
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'skill_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_workflow_activation_no_delete` BEFORE DELETE ON `workflow_revision_activation` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_revision_activation cannot be deleted';

CREATE TRIGGER `trg_workflow_activation_update` BEFORE UPDATE ON `workflow_revision_activation` FOR EACH ROW BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.workflow_revision_id <> OLD.workflow_revision_id
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workflow_revision_activation identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.updated_at < OLD.updated_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workflow_revision_activation must advance CAS version';
  END IF;
  IF OLD.runtime_status = 'revoked'
     AND NEW.runtime_status <> 'revoked'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'revoked workflow_revision cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_workflow_approval_decision_immutable` BEFORE UPDATE ON `workflow_approval_decision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_approval_decision is immutable';

CREATE TRIGGER `trg_workflow_approval_request_immutable` BEFORE UPDATE ON `workflow_approval_request` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_approval_request is immutable';

CREATE TRIGGER `trg_workflow_cap_cancel_immutable` BEFORE UPDATE ON `workflow_capability_cancellation_request` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_capability_cancellation_request is immutable'
;

CREATE TRIGGER `trg_workflow_deadline_immutable` BEFORE UPDATE ON `workflow_deadline_schedule` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_deadline_schedule is immutable';

CREATE TRIGGER `trg_workflow_draft_no_delete` BEFORE DELETE ON `workflow_draft` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_draft cannot be deleted';

CREATE TRIGGER `trg_workflow_draft_update` BEFORE UPDATE ON `workflow_draft` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.workflow_key <> OLD.workflow_key
     OR NOT (
       NEW.derived_from_workflow_revision_id
       <=> OLD.derived_from_workflow_revision_id
     )
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.created_at <> OLD.created_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workflow_draft identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.updated_at < OLD.updated_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workflow_draft update must advance CAS version';
  END IF;
  IF OLD.lifecycle_status = 'archived'
     AND NEW.lifecycle_status <> 'archived'
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archived workflow_draft cannot reactivate';
  END IF;
END;

CREATE TRIGGER `trg_workflow_edge_immutable` BEFORE UPDATE ON `workflow_activated_edge` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_activated_edge is immutable';

CREATE TRIGGER `trg_workflow_map_expansion_immutable` BEFORE UPDATE ON `workflow_map_expansion` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_map_expansion is immutable';

CREATE TRIGGER `trg_workflow_map_item_immutable` BEFORE UPDATE ON `workflow_map_item` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_map_item is immutable';

CREATE TRIGGER `trg_workflow_output_immutable` BEFORE UPDATE ON `workflow_output_fact` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_output_fact is immutable';

CREATE TRIGGER `trg_workflow_publication_no_delete` BEFORE DELETE ON `workflow_revision_publication` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_revision_publication cannot be deleted';

CREATE TRIGGER `trg_workflow_publication_no_update` BEFORE UPDATE ON `workflow_revision_publication` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_revision_publication is immutable';

CREATE TRIGGER `trg_workflow_revision_no_delete` BEFORE DELETE ON `workflow_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_revision cannot be deleted';

CREATE TRIGGER `trg_workflow_revision_published_immutable` BEFORE UPDATE ON `workflow_revision` FOR EACH ROW BEGIN
  IF OLD.lifecycle_status IN ('published', 'deprecated', 'revoked')
     AND (
       NEW.id <> OLD.id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NOT (NEW.workflow_definition_id <=> OLD.workflow_definition_id)
       OR NEW.workflow_key <> OLD.workflow_key
       OR NEW.revision <> OLD.revision
       OR NEW.canonical_digest <> OLD.canonical_digest
       OR NOT (NEW.topology <=> OLD.topology)
       OR NOT (NEW.input_schema <=> OLD.input_schema)
       OR NOT (NEW.output_schema <=> OLD.output_schema)
       OR NOT (NEW.presentation <=> OLD.presentation)
       OR NEW.created_at <> OLD.created_at
       OR NOT (NEW.published_at <=> OLD.published_at)
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'published workflow_revision content is immutable';
  END IF;
  IF NOT (
    NEW.lifecycle_status = OLD.lifecycle_status
    OR (
      OLD.lifecycle_status = 'draft'
      AND NEW.lifecycle_status IN ('published', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'published'
      AND NEW.lifecycle_status IN ('deprecated', 'revoked')
    )
    OR (
      OLD.lifecycle_status = 'deprecated'
      AND NEW.lifecycle_status = 'revoked'
    )
  )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workflow_revision lifecycle transition is invalid';
  END IF;
END;

CREATE TRIGGER `trg_workflow_switch_immutable` BEFORE UPDATE ON `workflow_switch_decision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workflow_switch_decision is immutable';

CREATE TRIGGER `trg_workspace_policy_revision_no_delete` BEFORE DELETE ON `workspace_policy_revision` FOR EACH ROW SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'workspace_policy_revision is immutable';

CREATE TRIGGER `trg_workspace_policy_revision_no_update` BEFORE UPDATE ON `workspace_policy_revision` FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.revision <> OLD.revision
     OR NEW.schema_version <> OLD.schema_version
     OR NOT (NEW.policy_document <=> OLD.policy_document)
     OR NEW.canonical_digest <> OLD.canonical_digest
     OR NOT (
       NEW.supersedes_revision_id
       <=> OLD.supersedes_revision_id
     )
     OR NEW.created_by_principal_id <> OLD.created_by_principal_id
     OR NEW.published_by_principal_id
        <> OLD.published_by_principal_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.published_at <> OLD.published_at
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workspace_policy_revision content is immutable';
  END IF;
  IF (OLD.lifecycle_status = 'revoked'
      AND NEW.lifecycle_status <> 'revoked')
     OR (OLD.lifecycle_status = 'deprecated'
         AND NEW.lifecycle_status = 'published')
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'workspace_policy_revision cannot reactivate';
  END IF;
END;

SET TIME_ZONE=@OLD_TIME_ZONE;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
