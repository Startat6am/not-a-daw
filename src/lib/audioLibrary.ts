export type LocalTrack = {
  id: string
  name: string
  type: string
  size: number
  duration?: number
  addedAt: number
  blob: Blob
  externalId?: string
  sourceUpdateId?: number
}

const DB_NAME = 'not-a-daw-library'
const DB_VERSION = 1
const STORE_NAME = 'tracks'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('This browser does not support local audio storage. Try a current version of Safari or Chrome.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('addedAt', 'addedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Could not open the local track library. Check browser storage permissions.'))
    request.onblocked = () => reject(new Error('The track library is busy in another tab. Close other tabs of this app and try again.'))
  })
}

export async function getTracks(): Promise<LocalTrack[]> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve((request.result as LocalTrack[]).sort((a, b) => a.addedAt - b.addedAt))
      request.onerror = () => reject(new Error('Could not read the local track library.'))
    })
  } finally {
    db.close()
  }
}

export async function addTracks(tracks: LocalTrack[]): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      tracks.forEach((track) => store.put(track))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save audio files. The browser may be out of storage space.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving audio files was cancelled.'))
    })
  } finally {
    db.close()
  }
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove the audio file.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Removing the audio file was cancelled.'))
    })
  } finally {
    db.close()
  }
}
