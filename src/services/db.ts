const DB_NAME = "gpt-image-studio";
const DB_VERSION = 1;

export const STORE_NAMES = {
  conversations: "conversations",
  messages: "messages",
  imageAssets: "imageAssets",
  imageBlobs: "imageBlobs",
  settings: "settings",
} as const;

type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function getStudioDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAMES.conversations)) {
          const store = db.createObjectStore(STORE_NAMES.conversations, {
            keyPath: "id",
          });
          store.createIndex("updatedAtMs", "updatedAtMs");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.messages)) {
          const store = db.createObjectStore(STORE_NAMES.messages, {
            keyPath: "id",
          });
          store.createIndex("conversationId", "conversationId");
          store.createIndex("createdAtMs", "createdAtMs");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.imageAssets)) {
          const store = db.createObjectStore(STORE_NAMES.imageAssets, {
            keyPath: "id",
          });
          store.createIndex("createdAtMs", "createdAtMs");
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
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
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

export async function putManyInStore<T>(storeName: StoreName, values: T[]) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  values.forEach((value) => store.put(value));
  await transactionDone(transaction);
}

export async function deleteFromStore(storeName: StoreName, key: IDBValidKey) {
  const db = await getStudioDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.delete(key);
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
