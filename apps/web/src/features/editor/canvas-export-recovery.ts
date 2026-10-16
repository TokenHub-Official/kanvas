import type {
  AllocateCanvasExportBody,
  CanvasExportTarget,
  CanvasExportUploadSession,
  CommittedCanvasExport,
} from "@kanvas/contracts/api";

export interface PersistedCanvasExportRecovery {
  readonly agentActionReceiptId?: string;
  readonly allocationKey: string;
  readonly blob?: Blob;
  readonly exportSessionId: string;
  readonly filename: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly quality: number;
  readonly request: AllocateCanvasExportBody;
  readonly target: CanvasExportTarget;
  readonly uploadCompleted: boolean;
}

export interface RecoveredCanvasExportPending extends PersistedCanvasExportRecovery {
  readonly result?: CommittedCanvasExport;
}

export interface RecoveredCanvasExportResult {
  readonly artifactId: string;
  readonly assetId?: string;
  readonly assetVersion?: number;
  readonly filename: string;
  readonly pageName: string;
}

export interface CanvasExportRecoveryProjection {
  readonly pending: readonly RecoveredCanvasExportPending[];
  readonly results: readonly RecoveredCanvasExportResult[];
  readonly unavailableCount: number;
}

interface StoredCanvasExportRecoveryBatch {
  readonly canvasDraftId: string;
  readonly items: readonly PersistedCanvasExportRecovery[];
  readonly key: string;
  readonly schemaVersion: 1;
  readonly updatedAt: string;
  readonly workspaceId: string;
}

const databaseName = "kanvas-canvas-export-v1";
const databaseVersion = 1;
const storeName = "export-batches";

export interface AgentExportRecoveryScope {
  readonly documentVersion: number;
  readonly pageId: string;
}

function batchKey(
  workspaceId: string,
  canvasDraftId: string,
  agent?: AgentExportRecoveryScope,
): string {
  const base = `${workspaceId}:${canvasDraftId}`;
  return agent
    ? `${base}:agent:${agent.documentVersion}:${encodeURIComponent(agent.pageId)}`
    : base;
}

function localStorageKey(
  workspaceId: string,
  canvasDraftId: string,
  agent?: AgentExportRecoveryScope,
): string {
  return `kanvas:canvas-export:v1:${batchKey(workspaceId, canvasDraftId, agent)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTarget(value: unknown): value is CanvasExportTarget {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "artifact_only") {
    return true;
  }
  if (value.kind === "new_asset") {
    return (
      typeof value.name === "string" && typeof value.assetType === "string"
    );
  }
  return (
    value.kind === "existing_asset" &&
    typeof value.assetId === "string" &&
    typeof value.expectedVersion === "number"
  );
}

function isRecoveryItem(
  value: unknown,
  canvasDraftId: string,
): value is PersistedCanvasExportRecovery {
  if (!isRecord(value) || !isRecord(value.request)) {
    return false;
  }
  const request = value.request;
  return (
    (value.agentActionReceiptId === undefined ||
      (typeof value.agentActionReceiptId === "string" &&
        /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value.agentActionReceiptId))) &&
    typeof value.allocationKey === "string" &&
    typeof value.exportSessionId === "string" &&
    typeof value.filename === "string" &&
    typeof value.pageId === "string" &&
    typeof value.pageName === "string" &&
    typeof value.quality === "number" &&
    typeof value.uploadCompleted === "boolean" &&
    request.canvasDraftId === canvasDraftId &&
    request.pageId === value.pageId &&
    typeof request.documentVersion === "number" &&
    typeof request.format === "string" &&
    typeof request.width === "number" &&
    typeof request.height === "number" &&
    typeof request.transparentBackground === "boolean" &&
    typeof request.displayFilename === "string" &&
    isTarget(value.target) &&
    (value.blob === undefined || value.blob instanceof Blob)
  );
}

export function agentCanvasExportRecoveryMatches(
  item: PersistedCanvasExportRecovery,
  request: {
    readonly actionReceiptId: string;
    readonly canvasDraftId: string;
    readonly documentVersion: number;
    readonly pageId: string;
  },
): boolean {
  return (
    Boolean(
      item.agentActionReceiptId ||
      item.allocationKey === request.actionReceiptId,
    ) &&
    item.target.kind === "artifact_only" &&
    item.request.format === "png" &&
    item.request.canvasDraftId === request.canvasDraftId &&
    item.request.documentVersion === request.documentVersion &&
    item.pageId === request.pageId
  );
}

function isStoredBatch(
  value: unknown,
  workspaceId: string,
  canvasDraftId: string,
  agent?: AgentExportRecoveryScope,
): value is StoredCanvasExportRecoveryBatch {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.workspaceId === workspaceId &&
    value.canvasDraftId === canvasDraftId &&
    value.key === batchKey(workspaceId, canvasDraftId, agent) &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.items) &&
    value.items.every((item) => isRecoveryItem(item, canvasDraftId))
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(
        request.error ?? new Error("Canvas Export recovery request failed."),
      );
    });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("abort", () => {
      reject(
        transaction.error ??
          new Error("Canvas Export recovery transaction aborted."),
      );
    });
    transaction.addEventListener("error", () => {
      reject(
        transaction.error ??
          new Error("Canvas Export recovery transaction failed."),
      );
    });
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, {
          keyPath: "key",
        });
      }
    });
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(
        request.error ??
          new Error("Canvas Export recovery storage could not open."),
      );
    });
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    const [result] = await Promise.all([
      requestResult(request),
      transactionComplete(transaction),
    ]);
    return result;
  } finally {
    database.close();
  }
}

export async function saveCanvasExportRecovery(
  workspaceId: string,
  canvasDraftId: string,
  items: readonly PersistedCanvasExportRecovery[],
  agent?: AgentExportRecoveryScope,
): Promise<void> {
  const record: StoredCanvasExportRecoveryBatch = {
    canvasDraftId,
    items,
    key: batchKey(workspaceId, canvasDraftId, agent),
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    workspaceId,
  };
  let fallbackSaved = false;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(
        localStorageKey(workspaceId, canvasDraftId, agent),
        JSON.stringify({
          ...record,
          items: record.items.map((item) => {
            const mirror = { ...item };
            delete mirror.blob;
            return mirror;
          }),
        }),
      );
      fallbackSaved = true;
    } catch {
      // IndexedDB remains the primary store for rendered blobs.
    }
  }
  try {
    await withStore("readwrite", (store) => store.put(record));
  } catch (error) {
    if (!fallbackSaved) {
      throw error;
    }
  }
}

export async function loadCanvasExportRecovery(
  workspaceId: string,
  canvasDraftId: string,
  agent?: AgentExportRecoveryScope,
): Promise<readonly PersistedCanvasExportRecovery[]> {
  let indexedRecord: StoredCanvasExportRecoveryBatch | undefined;
  try {
    const value = await withStore<unknown>("readonly", (store) =>
      store.get(batchKey(workspaceId, canvasDraftId, agent)),
    );
    if (isStoredBatch(value, workspaceId, canvasDraftId, agent)) {
      indexedRecord = value;
    }
  } catch {
    // The non-secret localStorage mirror remains available.
  }
  let fallbackRecord: StoredCanvasExportRecoveryBatch | undefined;
  if (typeof localStorage !== "undefined") {
    try {
      const value = JSON.parse(
        localStorage.getItem(
          localStorageKey(workspaceId, canvasDraftId, agent),
        ) ?? "null",
      ) as unknown;
      if (isStoredBatch(value, workspaceId, canvasDraftId, agent)) {
        fallbackRecord = value;
      }
    } catch {
      // Invalid fallback entries are ignored fail-closed.
    }
  }
  const record =
    indexedRecord &&
    (!fallbackRecord || indexedRecord.updatedAt >= fallbackRecord.updatedAt)
      ? indexedRecord
      : fallbackRecord;
  return record?.items ?? [];
}

export async function removeCanvasExportRecovery(
  workspaceId: string,
  canvasDraftId: string,
  agent?: AgentExportRecoveryScope,
): Promise<void> {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(localStorageKey(workspaceId, canvasDraftId, agent));
  }
  await withStore("readwrite", (store) =>
    store.delete(batchKey(workspaceId, canvasDraftId, agent)),
  ).catch((error: unknown) => {
    if (typeof localStorage === "undefined") {
      throw error;
    }
  });
}

export async function recoverCanvasExports(
  recovery: readonly PersistedCanvasExportRecovery[],
  lookup: (exportSessionId: string) => Promise<CanvasExportUploadSession>,
): Promise<CanvasExportRecoveryProjection> {
  const settled = await Promise.allSettled(
    recovery.map((item) => lookup(item.exportSessionId)),
  );
  const pending: RecoveredCanvasExportPending[] = [];
  const results: RecoveredCanvasExportResult[] = [];
  let unavailableCount = 0;

  settled.forEach((entry, index) => {
    const item = recovery[index];
    if (!item) {
      return;
    }
    if (entry.status === "rejected") {
      unavailableCount += 1;
      pending.push(item);
      return;
    }
    const session = entry.value;
    const result = session.result;
    pending.push({
      ...item,
      uploadCompleted: session.state !== "open" || item.uploadCompleted,
      ...(result ? { result } : {}),
    });
    if (result) {
      results.push({
        artifactId: result.artifactId,
        ...(result.assetId ? { assetId: result.assetId } : {}),
        ...(result.assetVersion ? { assetVersion: result.assetVersion } : {}),
        filename: item.filename,
        pageName: item.pageName,
      });
    }
  });

  return {
    pending,
    results,
    unavailableCount,
  };
}
