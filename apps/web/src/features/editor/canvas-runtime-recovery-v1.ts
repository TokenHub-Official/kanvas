import type { EditorRuntimeDocumentV1 } from "./editor-runtime-v1.js";

const databaseName = "kanvas-canvas-v1-recovery";
const databaseVersion = 1;
const storeName = "runtime-snapshots";

export interface CanvasRuntimeRecoveryFileV1 {
  readonly file: File;
  readonly localId: string;
  readonly name: string;
  readonly uploadCompleted?: boolean;
  readonly uploadSessionId?: string;
}

export interface CanvasRuntimeRecoveryRecordV1 {
  readonly document: EditorRuntimeDocumentV1;
  readonly files: readonly CanvasRuntimeRecoveryFileV1[];
  readonly key: string;
  readonly recoveryId: string;
  readonly updatedAt: number;
  readonly workspaceId: string;
}

function key(workspaceId: string, recoveryId: string) {
  return `${workspaceId}:${recoveryId}`;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recoveryRecord(
  value: unknown,
  workspaceId: string,
  recoveryId: string,
): value is CanvasRuntimeRecoveryRecordV1 {
  if (!objectRecord(value)) {
    return false;
  }
  const document = value.document;
  const files = value.files;
  return (
    value.key === key(workspaceId, recoveryId) &&
    value.workspaceId === workspaceId &&
    value.recoveryId === recoveryId &&
    typeof value.updatedAt === "number" &&
    objectRecord(document) &&
    document.schemaVersion === "kanvas.editor-document/v1" &&
    Array.isArray(files) &&
    files.every(
      (item) =>
        objectRecord(item) &&
        typeof item.localId === "string" &&
        typeof item.name === "string" &&
        (item.uploadCompleted === undefined ||
          typeof item.uploadCompleted === "boolean") &&
        (item.uploadSessionId === undefined ||
          typeof item.uploadSessionId === "string") &&
        item.file instanceof Blob,
    )
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Canvas recovery request failed."));
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
        transaction.error ?? new Error("Canvas recovery transaction aborted."),
      );
    });
    transaction.addEventListener("error", () => {
      reject(
        transaction.error ?? new Error("Canvas recovery transaction failed."),
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
        request.error ?? new Error("Canvas recovery storage could not open."),
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

export function canvasRuntimeRecoveryIdV1(
  workspaceId: string,
  canvasDraftId: string | undefined,
): string {
  if (canvasDraftId) {
    return canvasDraftId;
  }
  const storageKey = `kanvas:canvas-v1-recovery:${workspaceId}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  sessionStorage.setItem(storageKey, created);
  return created;
}

export async function saveCanvasRuntimeRecoveryV1(input: {
  readonly document: EditorRuntimeDocumentV1;
  readonly files: readonly CanvasRuntimeRecoveryFileV1[];
  readonly recoveryId: string;
  readonly workspaceId: string;
}): Promise<void> {
  const record: CanvasRuntimeRecoveryRecordV1 = {
    key: key(input.workspaceId, input.recoveryId),
    workspaceId: input.workspaceId,
    recoveryId: input.recoveryId,
    document: input.document,
    files: input.files,
    updatedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(record));
}

export async function loadCanvasRuntimeRecoveryV1(
  workspaceId: string,
  recoveryId: string,
): Promise<CanvasRuntimeRecoveryRecordV1 | undefined> {
  const value: unknown = await withStore<unknown>(
    "readonly",
    (store) => store.get(key(workspaceId, recoveryId)) as IDBRequest<unknown>,
  );
  return recoveryRecord(value, workspaceId, recoveryId) ? value : undefined;
}

export async function removeCanvasRuntimeRecoveryV1(
  workspaceId: string,
  recoveryId: string,
): Promise<void> {
  await withStore("readwrite", (store) =>
    store.delete(key(workspaceId, recoveryId)),
  );
}
