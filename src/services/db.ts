const DB_NAME = "gpt-image-studio";
const DB_VERSION = 4;

export const STORE_NAMES = {
  conversations: "conversations",
  messages: "messages",
  imageAssets: "imageAssets",
  imageBlobs: "imageBlobs",
  settings: "settings",
  conversationDrafts: "conversationDrafts",
  analyticsEvents: "analyticsEvents",
} as const;

type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function getStudioDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;

        if (!db.objectStoreNames.contains(STORE_NAMES.conversations)) {
          const store = db.createObjectStore(STORE_NAMES.conversations, {
            keyPath: "id",
          });
          store.createIndex("updatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.messages)) {
          const store = db.createObjectStore(STORE_NAMES.messages, {
            keyPath: "id",
          });
          store.createIndex("conversationId", "conversationId");
          store.createIndex("createdAt", "createdAt");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.imageAssets)) {
          const store = db.createObjectStore(STORE_NAMES.imageAssets, {
            keyPath: "id",
          });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("conversationId", "conversationId");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.imageBlobs)) {
          db.createObjectStore(STORE_NAMES.imageBlobs, {
            keyPath: "key",
          });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
          db.createObjectStore(STORE_NAMES.settings, {
            keyPath: "key",
          });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.conversationDrafts)) {
          const store = db.createObjectStore(STORE_NAMES.conversationDrafts, {
            keyPath: "conversationId",
          });
          store.createIndex("updatedAtMs", "updatedAtMs");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.analyticsEvents)) {
          const store = db.createObjectStore(STORE_NAMES.analyticsEvents, {
            keyPath: "id",
          });
          store.createIndex("occurredAt", "occurredAt");
          store.createIndex("eventName", "eventName");
          store.createIndex("conversationId", "conversationId");
        }

        if (event.oldVersion < 2) {
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.conversations,
            "updatedAtMs",
            "updatedAt",
          );
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.messages,
            "createdAtMs",
            "createdAt",
          );
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.imageAssets,
            "createdAtMs",
            "createdAt",
          );
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

function replaceIndex(
  transaction: IDBTransaction | null,
  db: IDBDatabase,
  storeName: StoreName,
  oldIndexName: string,
  newIndexName: string,
) {
  if (!transaction || !db.objectStoreNames.contains(storeName)) return;

  const store = transaction.objectStore(storeName);
  if (store.indexNames.contains(oldIndexName)) {
    store.deleteIndex(oldIndexName);
  }
  if (!store.indexNames.contains(newIndexName)) {
    store.createIndex(newIndexName, newIndexName);
  }
}

export async function getAllFromStore<T>(storeName: StoreName) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  return requestToPromise<T[]>(store.getAll());
}

export async function getFromStore<T>(storeName: StoreName, key: IDBValidKey) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  return requestToPromise<T | undefined>(store.get(key));
}

export async function putInStore<T>(storeName: StoreName, value: T) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.put(value);
  await transactionDone(transaction);
}

export async function deleteFromStore(storeName: StoreName, key: IDBValidKey) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.delete(key);
  await transactionDone(transaction);
}

export async function clearStore(storeName: StoreName) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.clear();
  await transactionDone(transaction);
}

function requestToPromise<T>(request: IDBRequest) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
