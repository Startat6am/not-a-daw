const CACHE_NAME = 'not-a-daw-shell-v2'
const APP_SHELL = ['/', '/manifest.webmanifest']
const DB_NAME = 'not-a-daw-library'
const STORE_NAME = 'tracks'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]))
})

function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('addedAt', 'addedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function saveSharedFiles(request) {
  const form = await request.formData()
  const files = form.getAll('files').filter((file) => file instanceof File && file.size > 0)
  if (!files.length) return
  const db = await openLibrary()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const file of files) {
        if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|aiff?|ogg|flac|opus)$/i.test(file.name)) continue
        store.put({ id: 'track-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9), name: file.name, type: file.type || 'audio/unknown', size: file.size, addedAt: Date.now(), blob: file })
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try { await saveSharedFiles(event.request) } catch (error) { console.error('Shared audio import failed', error) }
      return Response.redirect('/', 303)
    })())
    return
  }
  if (event.request.method !== 'GET') return
  event.respondWith(caches.match(event.request).then((cached) => {
    if (cached) return cached
    return fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
      }
      return response
    }).catch(() => caches.match('/'))
  }))
})
