#!/usr/bin/env node

import { createPool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { bootstrapImageCompositionWorkflow } from "./bootstrap-image-composition-workflow.js";
import {
  brandSocialStarterWorkflowDescriptor,
  imageGenerateWorkflowDescriptor,
  posterComposeSubjectWorkflowDescriptor,
  posterGenerateCompleteWorkflowDescriptor,
  posterGenerateSimpleWorkflowDescriptor,
} from "./bootstrap-image-composition-workflows.js";

const workspaceId = "01K00000000000000000000000";

interface PrincipalRow extends RowDataPacket {
  readonly id: string;
}

const connectionConfig = loadDatabaseConnectionConfig(process.env);
const pool = createPool({
  ...connectionConfig,
  connectionLimit: 1,
  timezone: "Z",
  decimalNumbers: false,
});
const connection = await pool.getConnection();

try {
  await connection.beginTransaction();
  const [principalRows] = await connection.execute<PrincipalRow[]>(
    `SELECT administrator.principal_id AS id
     FROM instance_administrator AS administrator
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = administrator.principal_id
      AND membership.workspace_id = ?
      AND membership.status = 'active'
     WHERE administrator.status = 'active'
     ORDER BY administrator.principal_id
     LIMIT 1
     FOR SHARE`,
    [workspaceId],
  );
  const actorId = principalRows[0]?.id;
  if (!actorId) {
    throw new Error(
      "Poster Workflow bootstrap requires an active development administrator in the Demo Workspace.",
    );
  }
  const simple = await bootstrapImageCompositionWorkflow(connection, {
    workspaceId,
    actorId,
    descriptor: posterGenerateSimpleWorkflowDescriptor,
  });
  const complete = await bootstrapImageCompositionWorkflow(connection, {
    workspaceId,
    actorId,
    descriptor: posterGenerateCompleteWorkflowDescriptor,
  });
  const complex = await bootstrapImageCompositionWorkflow(connection, {
    workspaceId,
    actorId,
    descriptor: posterComposeSubjectWorkflowDescriptor,
  });
  const brand = await bootstrapImageCompositionWorkflow(connection, {
    workspaceId,
    actorId,
    descriptor: brandSocialStarterWorkflowDescriptor,
  });
  const imageGenerate = await bootstrapImageCompositionWorkflow(connection, {
    workspaceId,
    actorId,
    descriptor: imageGenerateWorkflowDescriptor,
  });
  await connection.commit();
  process.stdout.write(
    `${JSON.stringify(
      { schemaVersion: 1, simple, complete, complex, brand, imageGenerate },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
