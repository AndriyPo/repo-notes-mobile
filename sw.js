import { put } from './storage.js';
import { sharedFields } from './share.js';

const base = new URL('./', import.meta.url);
const prefix = 'repo-notes-shell:' + base.pathname + ':';
const cacheName = prefix + 'v1';
const files = ['./', './index.html', './app.js', './styles.css', './core.js', './share.js', './storage.js', './queue.js', './manifest.webmanifest', './icons/192.png', './icons/512.png', './icons/maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files.map(path => new URL(path, base).href))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  if (event.request.method === 'POST' && url.pathname === new URL('./share-target', base).pathname) {
    event.respondWith((async () => {
      try {
        const fields = sharedFields(await event.request.formData());
        const id = crypto.randomUUID();
        // Only an opaque ID reaches the address bar or hosting server. Shared text
        // remains in IndexedDB and is never uploaded without tapping Save.
        await put('shares', { id, fields, received: Date.now() });
        return Response.redirect(new URL('./?share=' + encodeURIComponent(id), base).href, 303);
      } catch {
        return Response.redirect(new URL('./?share-error=1', base).href, 303);
      }
    })());
    return;
  }
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(new URL('./index.html', base).href)).then(cached => cached || fetch(event.request)));
    return;
  }
  if (files.some(path => new URL(path, base).href === url.href)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
  }
});
