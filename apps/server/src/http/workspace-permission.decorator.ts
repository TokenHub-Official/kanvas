import { SetMetadata } from "@nestjs/common";
import type { WorkspacePermissionId } from "@kanvas/application";

export const WORKSPACE_PERMISSION_METADATA = Symbol(
  "KANVAS_WORKSPACE_PERMISSION",
);

export function RequireWorkspacePermission(
  permission: WorkspacePermissionId,
): MethodDecorator {
  return SetMetadata(WORKSPACE_PERMISSION_METADATA, permission);
}
