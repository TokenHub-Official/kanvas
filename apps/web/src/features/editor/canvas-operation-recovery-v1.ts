import {
  canvasOperationSessionSchemaVersionV1,
  normalizeCanvasOperationSessionV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";

const databaseName = "kanvas-canvas-operation-v1";
const databaseVersion = 2;
const storeName = "operation-sessions";
const MAX_LOCAL_STORAGE_RECOVERY_ENTRIES = 10_000;

interface StoredCanvasOperationSessionV1 {
  readonly key: string;
  readonly recoveryId: string;
  readonly session: CanvasOperationSessionV1;
  readonly workspaceId: string;
}

function key(
  workspaceId: string,
  recoveryId: string,
  sessionId: string,
): string {
  return `${workspaceId}:${recoveryId}:${sessionId}`;
}

function localStoragePrefix(workspaceId: string, recoveryId: string): string {
  return `kanvas:canvas-operation:v1:${workspaceId}:${recoveryId}:`;
}

function localStorageKey(
  workspaceId: string,
  recoveryId: string,
  sessionId: string,
): string {
  return `${localStoragePrefix(workspaceId, recoveryId)}${sessionId}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function storedSession(
  value: unknown,
  workspaceId: string,
  recoveryId: string,
): StoredCanvasOperationSessionV1 | undefined {
  if (!isRecord(value) || !isRecord(value.session)) {
    return undefined;
  }
  const session = normalizeCanvasOperationSessionV1(value.session);
  return session &&
    value.workspaceId === workspaceId &&
    value.recoveryId === recoveryId &&
    session.schemaVersion === canvasOperationSessionSchemaVersionV1 &&
    value.key === key(workspaceId, recoveryId, session.id)
    ? {
        key: value.key,
        workspaceId,
        recoveryId,
        session,
      }
    : undefined;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(
        request.error ?? new Error("Canvas operation recovery request failed."),
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
          new Error("Canvas operation recovery transaction aborted."),
      );
    });
    transaction.addEventListener("error", () => {
      reject(
        transaction.error ??
          new Error("Canvas operation recovery transaction failed."),
      );
    });
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const store = request.result.objectStoreNames.contains(storeName)
        ? request.transaction!.objectStore(storeName)
        : request.result.createObjectStore(storeName, {
            keyPath: "key",
          });
      if (!store.indexNames.contains("by-recovery")) {
        store.createIndex("by-recovery", ["workspaceId", "recoveryId"], {
          unique: false,
        });
      }
    });
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(
        request.error ??
          new Error("Canvas operation recovery storage could not open."),
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

export async function saveCanvasOperationSessionV1(input: {
  readonly recoveryId: string;
  readonly session: CanvasOperationSessionV1;
  readonly workspaceId: string;
}): Promise<void> {
  const record: StoredCanvasOperationSessionV1 = {
    key: key(input.workspaceId, input.recoveryId, input.session.id),
    workspaceId: input.workspaceId,
    recoveryId: input.recoveryId,
    session: input.session,
  };
  let fallbackSaved = false;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(
        localStorageKey(input.workspaceId, input.recoveryId, input.session.id),
        JSON.stringify(record),
      );
      fallbackSaved = true;
    } catch {
      // IndexedDB remains the primary recovery store.
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

export async function listCanvasOperationSessionsV1(
  workspaceId: string,
  recoveryId: string,
): Promise<readonly CanvasOperationSessionV1[]> {
  const sessions = new Map<string, CanvasOperationSessionV1>();
  let indexedDatabaseAvailable = false;
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index("by-recovery");
      const request = index.getAll([workspaceId, recoveryId]) as IDBRequest<
        unknown[]
      >;
      const [values] = await Promise.all([
        requestResult(request),
        transactionComplete(transaction),
      ]);
      for (const value of values) {
        const stored = storedSession(value, workspaceId, recoveryId);
        if (stored) {
          sessions.set(stored.session.id, stored.session);
        }
      }
      indexedDatabaseAvailable = true;
    } finally {
      database.close();
    }
  } catch {
    // The localStorage mirror remains available below.
  }
  if (typeof localStorage !== "undefined") {
    const prefix = localStoragePrefix(workspaceId, recoveryId);
    for (
      let index = 0;
      index < Math.min(localStorage.length, MAX_LOCAL_STORAGE_RECOVERY_ENTRIES);
      index += 1
    ) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(prefix)) {
        continue;
      }
      try {
        const value = JSON.parse(
          localStorage.getItem(storageKey) ?? "null",
        ) as unknown;
        const stored = storedSession(value, workspaceId, recoveryId);
        if (stored) {
          const current = sessions.get(stored.session.id);
          if (!current || stored.session.updatedAt > current.updatedAt) {
            sessions.set(stored.session.id, stored.session);
          }
        }
      } catch {
        // Invalid local fallback entries are ignored fail-closed.
      }
    }
  } else if (!indexedDatabaseAvailable) {
    throw new Error("Canvas operation recovery storage is unavailable.");
  }
  return Object.freeze(
    [...sessions.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
}

export async function removeCanvasOperationSessionV1(
  workspaceId: string,
  recoveryId: string,
  sessionId: string,
): Promise<void> {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(
      localStorageKey(workspaceId, recoveryId, sessionId),
    );
  }
  await withStore("readwrite", (store) =>
    store.delete(key(workspaceId, recoveryId, sessionId)),
  ).catch((error: unknown) => {
    if (typeof localStorage === "undefined") {
      throw error;
    }
  });
}

export async function pruneCanvasOperationSessionsV1(
  workspaceId: string,
  recoveryId: string,
  keepSessionId?: string,
): Promise<void> {
  const sessions = await listCanvasOperationSessionsV1(workspaceId, recoveryId);
  await Promise.all(
    sessions
      .filter((session) => session.id !== keepSessionId)
      .map((session) =>
        removeCanvasOperationSessionV1(workspaceId, recoveryId, session.id),
      ),
  );
}

export async function promoteCanvasOperationSessionsV1(
  workspaceId: string,
  sourceRecoveryId: string,
  targetRecoveryId: string,
): Promise<void> {
  if (sourceRecoveryId === targetRecoveryId) {
    return;
  }
  const sessions = await listCanvasOperationSessionsV1(
    workspaceId,
    sourceRecoveryId,
  );
  for (const session of sessions) {
    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId: targetRecoveryId,
      session,
    });
  }
  for (const session of sessions) {
    await removeCanvasOperationSessionV1(
      workspaceId,
      sourceRecoveryId,
      session.id,
    );
  }
}
