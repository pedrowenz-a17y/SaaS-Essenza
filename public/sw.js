const CACHE = "essenza-offline-v1";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/offline.html", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("essenza-offline-") && key !== CACHE).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === "/icon-192.png") {
    event.respondWith(caches.match(event.request).then(hit => hit ?? fetch(event.request)));
    return;
  }
  if (event.request.mode === "navigate" && event.request.method === "GET") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  }
});
