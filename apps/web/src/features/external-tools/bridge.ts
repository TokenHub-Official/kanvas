/** Only a private MessagePort receives requests; never accept global window messages. */
export interface ToolRequest {
  readonly version: 1;
  readonly id: string;
  readonly method:
    "capabilities.list" | "run.start" | "run.status" | "run.cancel";
  readonly params: Record<string, unknown>;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseToolRequest(value: unknown): ToolRequest | undefined {
  const message = record(value);
  if (
    !message ||
    message.version !== 1 ||
    typeof message.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(message.id) ||
    typeof message.method !== "string" ||
    !["capabilities.list", "run.start", "run.status", "run.cancel"].includes(
      String(message.method),
    ) ||
    !record(message.params)
  )
    return undefined;
  try {
    if (JSON.stringify(message).length > 32_768) return undefined;
  } catch {
    return undefined;
  }
  return message as unknown as ToolRequest;
}

export function connectToolPort(
  port: MessagePort,
  execute: (request: ToolRequest) => Promise<unknown>,
): () => void {
  let closed = false;
  let inFlight = 0;
  const receipts = new Map<
    string,
    { fingerprint: string; result: Promise<unknown> }
  >();
  port.onmessage = (event: MessageEvent<unknown>) => {
    const request = parseToolRequest(event.data);
    if (closed || !request) return;
    const reply = (value: unknown): void => {
      if (!closed)
        port.postMessage({ version: 1, id: request.id, ...record(value) });
    };
    const fingerprint = JSON.stringify([request.method, request.params]);
    const existing = receipts.get(request.id);
    if (existing && existing.fingerprint !== fingerprint) {
      reply({ ok: false, error: "request_conflict" });
      return;
    }
    if (inFlight >= 8 || (!existing && receipts.size >= 1024)) {
      reply({ ok: false, error: "session_limit" });
      return;
    }
    const result =
      existing?.result ??
      Promise.resolve()
        .then(() => execute(request))
        .then(
          (data) => ({ ok: true, data }),
          (error: unknown) => ({
            ok: false,
            error:
              error instanceof ToolBridgeError ? error.code : "request_failed",
          }),
        );
    receipts.set(request.id, { fingerprint, result });
    inFlight += 1;
    void result.then(reply).finally(() => {
      inFlight -= 1;
    });
  };
  port.start();
  return () => {
    closed = true;
    port.onmessage = null;
    port.close();
  };
}

export class ToolBridgeError extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}
