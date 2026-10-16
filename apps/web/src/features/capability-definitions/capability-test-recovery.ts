const capabilityTestRecoveryPrefix = "kanvas:capability-test-recovery:v1";

export interface CapabilityTestRecoveryScope {
  readonly capabilityId: string;
  readonly principalId: string;
  readonly workspaceId: string;
}

export interface CapabilityTestRecovery extends CapabilityTestRecoveryScope {
  readonly schemaVersion: 1;
  readonly browserRuntimeRequired: boolean;
  readonly capabilityKey: string;
  readonly contractRevisionId: string;
  readonly runId: string;
}

type CapabilityTestRecoveryStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

function browserSessionStorage(): CapabilityTestRecoveryStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function recoveryStorageKey(scope: CapabilityTestRecoveryScope): string {
  return [
    capabilityTestRecoveryPrefix,
    scope.principalId,
    scope.workspaceId,
    scope.capabilityId,
  ]
    .map(encodeURIComponent)
    .join(":");
}

export function readCapabilityTestRecovery(
  scope: CapabilityTestRecoveryScope,
  storage: CapabilityTestRecoveryStorage | undefined = browserSessionStorage(),
): CapabilityTestRecovery | undefined {
  if (!storage) return undefined;
  try {
    const value = JSON.parse(
      storage.getItem(recoveryStorageKey(scope)) ?? "null",
    ) as Partial<CapabilityTestRecovery> | null;
    if (
      value?.schemaVersion === 1 &&
      value.principalId === scope.principalId &&
      value.workspaceId === scope.workspaceId &&
      value.capabilityId === scope.capabilityId &&
      typeof value.capabilityKey === "string" &&
      value.capabilityKey.length > 0 &&
      typeof value.contractRevisionId === "string" &&
      value.contractRevisionId.length > 0 &&
      typeof value.runId === "string" &&
      value.runId.length > 0 &&
      typeof value.browserRuntimeRequired === "boolean"
    ) {
      return value as CapabilityTestRecovery;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function writeCapabilityTestRecovery(
  recovery: CapabilityTestRecovery,
  storage: CapabilityTestRecoveryStorage | undefined = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(recoveryStorageKey(recovery), JSON.stringify(recovery));
  } catch {
    /* The mounted dialog still retains this Run. */
  }
}

export function clearCapabilityTestRecovery(
  scope: CapabilityTestRecoveryScope,
  storage: CapabilityTestRecoveryStorage | undefined = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(recoveryStorageKey(scope));
  } catch {
    /* Session recovery is optional. */
  }
}
