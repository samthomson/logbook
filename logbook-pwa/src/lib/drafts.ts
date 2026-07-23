import type { BlobDescriptor } from '../types/nostr'

export interface RecordingDraft {
  id: string
  issueNumber: number
  target: { sectionId: string; respondingTo: string | null }
  blob: Blob
  duration: number
  waveform: number[]
  descriptor: BlobDescriptor | null
  updatedAt: number
}

const DB_NAME = 'logbook-recording-drafts'
const STORE = 'drafts'
const VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('issueNumber', 'issueNumber')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open recording draft store'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Recording draft operation failed'))
    })
  } finally {
    db.close()
  }
}

/** Store the source blob before upload so a reload/crash cannot lose the take. */
export async function saveDraft(draft: RecordingDraft): Promise<void> {
  await withStore('readwrite', (store) => store.put(draft))
}

export async function listDrafts(issueNumber: number): Promise<RecordingDraft[]> {
  const db = await openDb()
  try {
    return await new Promise<RecordingDraft[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('issueNumber').getAll(issueNumber)
      request.onsuccess = () => resolve((request.result as RecordingDraft[]).sort((a, b) => b.updatedAt - a.updatedAt))
      request.onerror = () => reject(request.error ?? new Error('Unable to read recording drafts'))
    })
  } finally {
    db.close()
  }
}

export async function deleteDraft(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

/** Test/support utility; never used by the application flow. */
export async function clearDrafts(): Promise<void> {
  await withStore('readwrite', (store) => store.clear())
}
