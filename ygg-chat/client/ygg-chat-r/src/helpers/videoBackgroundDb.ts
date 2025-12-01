const DB_NAME = 'yggdrasil_video_library_db'
const STORE_NAME = 'videos'
const DB_VERSION = 1

const openDatabase = async (): Promise<IDBDatabase> => {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is not available in this environment.')
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const runTransaction = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)

    transaction.onerror = () => reject(transaction.error)

    try {
      const request = operation(store)
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    } catch (error) {
      reject(error)
    }
  })
}

export const storeVideoBlob = async (id: string, blob: Blob): Promise<void> => {
  await runTransaction<IDBValidKey>('readwrite', store => store.put(blob, id))
}

export const getVideoBlob = async (id: string): Promise<Blob | null> => {
  return runTransaction<Blob | null>('readonly', store => store.get(id))
}

export const deleteVideoBlob = async (id: string): Promise<void> => {
  await runTransaction<undefined>('readwrite', store => store.delete(id))
}

export const clearVideoBlobs = async (): Promise<void> => {
  await runTransaction<undefined>('readwrite', store => store.clear())
}
