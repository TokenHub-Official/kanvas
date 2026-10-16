export const availableCapabilityBindingCountSql = `(
  SELECT COUNT(*)
  FROM capability_binding AS available_binding
  INNER JOIN capability_implementation_revision AS available_implementation
    ON available_implementation.workspace_id = available_binding.workspace_id
   AND available_implementation.id =
         available_binding.implementation_revision_id
  LEFT JOIN route_policy_revision AS available_route
    ON available_route.workspace_id = available_binding.workspace_id
   AND available_route.id = available_binding.route_policy_revision_id
  LEFT JOIN capability_implementation_model_resource AS available_resource_ref
    ON available_resource_ref.workspace_id = available_implementation.workspace_id
   AND available_resource_ref.implementation_revision_id =
         available_implementation.id
   AND available_resource_ref.resource_role = 'primary'
  LEFT JOIN model_resource_revision AS available_resource_revision
    ON available_resource_revision.workspace_id = available_resource_ref.workspace_id
   AND available_resource_revision.id =
         available_resource_ref.model_resource_revision_id
  LEFT JOIN model_resource AS available_resource
    ON available_resource.workspace_id = available_resource_revision.workspace_id
   AND available_resource.id = available_resource_revision.model_resource_id
  LEFT JOIN model_resource_revision_file AS available_resource_file
    ON available_resource_file.workspace_id =
         available_resource_revision.workspace_id
   AND available_resource_file.model_resource_revision_id =
         available_resource_revision.id
   AND available_resource_file.role = 'primary'
  LEFT JOIN stored_object AS available_resource_object
    ON available_resource_object.workspace_id = available_resource_file.workspace_id
   AND available_resource_object.id = available_resource_file.stored_object_id
   AND available_resource_object.delete_state = 'active'
  LEFT JOIN model_deployment AS available_deployment
    ON available_deployment.workspace_id = available_binding.workspace_id
   AND available_deployment.id = JSON_UNQUOTE(
     JSON_EXTRACT(available_route.route_document, '$.modelDeploymentId')
   )
  LEFT JOIN provider_endpoint AS available_endpoint
    ON available_endpoint.workspace_id = available_binding.workspace_id
   AND available_endpoint.id = available_deployment.provider_endpoint_id
  LEFT JOIN provider_setting AS available_setting
    ON available_setting.workspace_id = available_binding.workspace_id
   AND available_setting.provider_endpoint_id = available_endpoint.id
  LEFT JOIN credential AS available_credential
    ON available_credential.workspace_id = available_binding.workspace_id
   AND available_credential.id = JSON_UNQUOTE(
     JSON_EXTRACT(available_route.route_document, '$.credentialId')
   )
  LEFT JOIN budget_account AS available_budget
    ON available_budget.workspace_id = available_binding.workspace_id
   AND available_budget.id = JSON_UNQUOTE(
     JSON_EXTRACT(available_route.route_document, '$.budgetAccountId')
   )
  WHERE available_binding.workspace_id = definition.workspace_id
    AND available_binding.contract_revision_id = contract.id
    AND contract.lifecycle_status = 'published'
    AND available_binding.lifecycle_status = 'active'
    AND available_implementation.lifecycle_status = 'published'
    AND (
      available_implementation.source_kind <> 'model_resource'
      OR (
        available_resource.id IS NOT NULL
        AND available_resource.lifecycle_status = 'active'
        AND available_resource_object.id IS NOT NULL
        AND available_resource_revision.lifecycle_status IN (
          'published', 'deprecated'
        )
      )
    )
    AND (
      available_implementation.execution_target <> 'provider'
      OR (
        available_setting.id IS NOT NULL
        AND available_route.lifecycle_status = 'published'
        AND available_endpoint.lifecycle_status = 'active'
        AND available_endpoint.validation_status = 'passed'
        AND available_credential.active_secret_version_id IS NOT NULL
        AND available_budget.lifecycle_status = 'active'
        AND available_budget.period_start_at <= ?
        AND available_budget.period_end_at > ?
      )
    )
)`;
