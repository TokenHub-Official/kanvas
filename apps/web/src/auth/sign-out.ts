export interface SignOutLock {
  current: boolean;
}

interface PerformSignOutOptions {
  readonly lock: SignOutLock;
  readonly onFailure: () => void;
  readonly onRevoked: () => void;
  readonly revoke: () => Promise<void>;
}

export async function performSignOut({
  lock,
  onFailure,
  onRevoked,
  revoke,
}: PerformSignOutOptions): Promise<boolean> {
  if (lock.current) {
    return false;
  }

  lock.current = true;
  try {
    await revoke();
  } catch {
    lock.current = false;
    onFailure();
    return true;
  }

  onRevoked();
  return true;
}
