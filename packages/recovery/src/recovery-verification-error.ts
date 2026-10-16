export type RecoveryVerificationErrorCode =
  | "recovery_verification.invalid_argument"
  | "recovery_verification.deployment_mismatch"
  | "recovery_verification.configuration_mismatch"
  | "recovery_verification.runtime_mismatch"
  | "recovery_verification.operation_mismatch"
  | "recovery_verification.migration_mismatch"
  | "recovery_verification.object_mismatch"
  | "recovery_verification.secret_reference_mismatch"
  | "recovery_verification.secret_unverifiable"
  | "recovery_verification.invariant_violation"
  | "recovery_verification.audit_integrity_mismatch"
  | "recovery_verification.database_failure";

export class RecoveryVerificationError extends Error {
  constructor(
    readonly code: RecoveryVerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RecoveryVerificationError";
  }
}

export function failRecoveryVerification(
  code: RecoveryVerificationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new RecoveryVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
