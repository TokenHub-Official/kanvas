export const instanceSetupTokenHtmlPattern = "knv_setup_v1_[A-Za-z0-9_-]{43}";
export const instanceSetupSlugHtmlPattern =
  "[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?";
export const instanceSetupTokenPattern = new RegExp(
  `^${instanceSetupTokenHtmlPattern}$`,
  "u",
);
export const instanceSetupSlugPattern = new RegExp(
  `^${instanceSetupSlugHtmlPattern}$`,
  "u",
);
const instanceSetupHashParameter = "setup";
export const instanceSetupSessionStorageKey = "kanvas.instance-setup-token";

type InstanceSetupTokenStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function instanceSetupTokenFromHash(hash: string): string | undefined {
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const token = new URLSearchParams(normalizedHash)
    .get(instanceSetupHashParameter)
    ?.trim();
  return token && instanceSetupTokenPattern.test(token) ? token : undefined;
}

export function captureInstanceSetupToken(
  hash: string,
  storage: InstanceSetupTokenStorage,
): string | undefined {
  const hashToken = instanceSetupTokenFromHash(hash);
  if (hashToken) {
    storage.setItem(instanceSetupSessionStorageKey, hashToken);
    return hashToken;
  }
  const storedToken = storage.getItem(instanceSetupSessionStorageKey)?.trim();
  return storedToken && instanceSetupTokenPattern.test(storedToken)
    ? storedToken
    : undefined;
}

export function clearCapturedInstanceSetupToken(
  storage: Pick<Storage, "removeItem">,
): void {
  storage.removeItem(instanceSetupSessionStorageKey);
}

export type InstanceSetupField =
  | "setupToken"
  | "organizationName"
  | "organizationSlug"
  | "workspaceName"
  | "workspaceSlug";

export interface InstanceSetupFormValues {
  readonly setupToken: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
}

export type InstanceSetupFieldErrorCode =
  | "organizationNameRequired"
  | "organizationSlugRequired"
  | "setupTokenInvalid"
  | "setupTokenRejected"
  | "setupTokenRequired"
  | "slugInvalid"
  | "workspaceNameRequired"
  | "workspaceSlugRequired";

export type InstanceSetupFieldErrors = Partial<
  Readonly<Record<InstanceSetupField, InstanceSetupFieldErrorCode>>
>;

export const instanceSetupFieldOrder = Object.freeze([
  "setupToken",
  "organizationName",
  "organizationSlug",
  "workspaceName",
  "workspaceSlug",
] as const satisfies readonly InstanceSetupField[]);

export function normalizeInstanceSetupSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, INSTANCE_SETUP_SLUG_MAX_LENGTH);
}

export function validateInstanceSetupFields(
  values: InstanceSetupFormValues,
): InstanceSetupFieldErrors {
  const setupToken = values.setupToken.trim();
  const organizationName = values.organizationName.trim();
  const organizationSlug = values.organizationSlug.trim();
  const workspaceName = values.workspaceName.trim();
  const workspaceSlug = values.workspaceSlug.trim();
  const errors: Partial<
    Record<InstanceSetupField, InstanceSetupFieldErrorCode>
  > = {};
  if (!setupToken) {
    errors.setupToken = "setupTokenRequired";
  } else if (!instanceSetupTokenPattern.test(setupToken)) {
    errors.setupToken = "setupTokenInvalid";
  }
  if (!organizationName) {
    errors.organizationName = "organizationNameRequired";
  }
  if (!organizationSlug) {
    errors.organizationSlug = "organizationSlugRequired";
  } else if (!instanceSetupSlugPattern.test(organizationSlug)) {
    errors.organizationSlug = "slugInvalid";
  }
  if (!workspaceName) {
    errors.workspaceName = "workspaceNameRequired";
  }
  if (!workspaceSlug) {
    errors.workspaceSlug = "workspaceSlugRequired";
  } else if (!instanceSetupSlugPattern.test(workspaceSlug)) {
    errors.workspaceSlug = "slugInvalid";
  }
  return errors;
}

export function firstInstanceSetupErrorField(
  errors: InstanceSetupFieldErrors,
): InstanceSetupField | undefined {
  return instanceSetupFieldOrder.find((field) => Boolean(errors[field]));
}

export function clearInstanceSetupFieldError(
  errors: InstanceSetupFieldErrors,
  field: InstanceSetupField,
): InstanceSetupFieldErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

export type InstanceSetupRecoveryErrorCode =
  | "conflict"
  | "identityMismatch"
  | "sessionExpired"
  | "tokenRejected"
  | "unavailable";

export interface InstanceSetupFailureRecovery {
  readonly errorCode: InstanceSetupRecoveryErrorCode;
  readonly setupTokenFieldError?: InstanceSetupFieldErrorCode;
  readonly switchAccount: boolean;
}

export function instanceSetupFailureRecovery(
  status: number | undefined,
  code: string | undefined,
): InstanceSetupFailureRecovery {
  if (status === httpStatus.unauthorized) {
    return {
      errorCode: "sessionExpired",
      switchAccount: false,
    };
  }
  if (code === "instance_setup.identity_mismatch") {
    return {
      errorCode: "identityMismatch",
      switchAccount: true,
    };
  }
  if (code === "instance_setup.token_rejected") {
    return {
      errorCode: "tokenRejected",
      setupTokenFieldError: "setupTokenRejected",
      switchAccount: false,
    };
  }
  if (status === httpStatus.conflict) {
    return {
      errorCode: "conflict",
      switchAccount: false,
    };
  }
  return {
    errorCode: "unavailable",
    switchAccount: false,
  };
}
import { httpStatus } from "../api/http-status.js";

const INSTANCE_SETUP_SLUG_MAX_LENGTH = 80;
