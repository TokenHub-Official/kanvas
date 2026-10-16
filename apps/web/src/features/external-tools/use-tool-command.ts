import { useRef, useState } from "react";
import { ApiProblem } from "../../api/transport.js";
const serverErrorStatus = 500;
export function useCommand(onDone: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const pendingRef = useRef<() => Promise<unknown>>(undefined);
  async function retry() {
    if (!pendingRef.current || busy) return;
    setBusy(true);
    setError(undefined);
    setUncertain(false);
    try {
      await pendingRef.current();
      await onDone();
      pendingRef.current = undefined;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      if (err instanceof ApiProblem && err.status < serverErrorStatus)
        pendingRef.current = undefined;
      else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  function run(action: () => Promise<unknown>) {
    if (busy || pendingRef.current) return;
    pendingRef.current = action;
    void retry();
  }
  return {
    busy,
    error,
    retry,
    run,
    uncertain,
  };
}
