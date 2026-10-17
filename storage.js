const databaseName = 'repo-notes-mobile:' + new URL('./', import.meta.url).pathname;
export const lockName = databaseName + ':upload';
const draftBackupPrefix = databaseName + ':draft:';
let database;

// A synchronous draft journal closes the small gap between the last keystroke
// and an IndexedDB transaction starting, including immediate tab closure.
export function journalDraft(draft) {
  localStorage.setItem(draftBackupPrefix + draft.id, JSON.stringify(draft));
}
export function forgetJournal(id) {
  localStorage.removeItem(draftBackupPrefix + id);
}
export async function recoverDraftJournal() {
  const keys = Object.keys(localStorage).filter(key => key.startsWith(draftBackupPrefix));
  for (const key of keys) {
    let snapshot;
    try { snapshot = JSON.parse(localStorage.getItem(key)); } catch { continue; }
    if (!snapshot?.id || typeof snapshot.touched !== 'number') continue;
    const [current, queued, saved] = await Promise.all([get('drafts', snapshot.id), get('queue', snapshot.id), get('saved', snapshot.id)]);
    if (queued || saved) { forgetJournal(snapshot.id); continue; }
    if (!current || current.touched <= snapshot.touched) {
      if (snapshot.text?.trim() || snapshot.source?.trim() || snapshot.quote?.trim()) await put('drafts', snapshot);
      else { await remove('drafts', snapshot.id); forgetJournal(snapshot.id); }
    }
  }
}

export function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['drafts', 'queue', 'shares', 'saved']) db.createObjectStore(name, { keyPath: 'id' });
      db.createObjectStore('settings');
    };
    request.onerror = () => { database = undefined; reject(new Error('Local storage is unavailable. Allow site storage in Chrome to keep your captures.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  });
  return database;
}

export async function transaction(stores, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('Could not save on this device.'));
    tx.onabort = () => reject(tx.error || new Error('Local save was interrupted.'));
    try { value = work(tx); } catch (error) { tx.abort(); reject(error); }
  });
}

export async function get(store, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function list(store) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function put(store, value, key) {
  return transaction([store], 'readwrite', tx => {
    const objectStore = tx.objectStore(store);
    if (key === undefined) objectStore.put(value); else objectStore.put(value, key);
  });
}

export function remove(store, key) {
  return transaction([store], 'readwrite', tx => { tx.objectStore(store).delete(key); });
}

export function enqueue(capture) {
  // Draft and queued capture move together, including if the page is closed mid-save.
  return transaction(['drafts', 'queue'], 'readwrite', tx => {
    tx.objectStore('queue').add({ id: capture.id, capture, error: '' });
    tx.objectStore('drafts').delete(capture.id);
  });
}

export function acknowledge(item, url) {
  return transaction(['queue', 'saved'], 'readwrite', tx => {
    tx.objectStore('saved').put({ id: item.id, url, title: item.capture.title, savedAt: new Date().toISOString() });
    tx.objectStore('queue').delete(item.id);
  });
}

export function acceptShare(id, draft) {
  return transaction(['shares', 'drafts'], 'readwrite', tx => {
    const shares = tx.objectStore('shares');
    const request = shares.get(id);
    request.onsuccess = () => {
      if (!request.result) return;
      tx.objectStore('drafts').add(draft);
      shares.delete(id);
    };
  });
}
