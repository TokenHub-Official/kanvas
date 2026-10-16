import type { PoolConnection, RowDataPacket } from "mysql2/promise";

interface EmailVerificationPolicyRow extends RowDataPacket {
  readonly emailVerificationRequired: boolean | number;
}

export async function emailVerificationRequiredInTransaction(
  connection: PoolConnection,
  instanceId: string | undefined,
): Promise<boolean> {
  if (!instanceId) return true;
  const [rows] = await connection.execute<EmailVerificationPolicyRow[]>(
    `SELECT email_verification_required AS emailVerificationRequired
       FROM instance_registration_policy
      WHERE instance_id = ?
      LIMIT 1
      FOR SHARE`,
    [instanceId],
  );
  const value = rows[0]?.emailVerificationRequired;
  return value !== false && value !== 0;
}
