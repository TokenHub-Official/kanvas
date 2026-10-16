import { useCallback, useEffect, useRef, useState } from "react";

import { schedulePageHeadingFocus } from "./page-focus.js";

interface RetryResult {
  readonly isError: boolean;
}

export interface RecoveryLock {
  current: boolean;
}

export async function runPageQueryRecovery({
  focusRecoveredPage,
  lock,
  refetch,
}: {
  readonly focusRecoveredPage: () => void;
  readonly lock: RecoveryLock;
  readonly refetch: () => Promise<RetryResult>;
}): Promise<boolean> {
  if (lock.current) {
    return false;
  }

  lock.current = true;
  try {
    const result = await refetch();
    if (!result.isError) {
      focusRecoveredPage();
    }
  } catch {
    // The existing error state remains visible with its retry action focused.
  } finally {
    lock.current = false;
  }
  return true;
}

export function usePageQueryRecovery(refetch: () => Promise<RetryResult>): {
  readonly pending: boolean;
  readonly retry: () => void;
} {
  const lock = useRef<RecoveryLock>({ current: false });
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const retry = useCallback(() => {
    if (lock.current.current) {
      return;
    }
    setPending(true);
    void runPageQueryRecovery({
      focusRecoveredPage: schedulePageHeadingFocus,
      lock: lock.current,
      refetch,
    }).finally(() => {
      if (mounted.current) {
        setPending(false);
      }
    });
  }, [refetch]);

  return { pending, retry };
}
