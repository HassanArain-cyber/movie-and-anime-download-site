const STATIC_CACHE = "vault-static-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("vault-static-") && name !== STATIC_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API/auth/admin traffic or any private, user-specific response.
  if (url.pathname.startsWith("/api/") || url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return;

  if (request.mode === "navigate") {
    // Network-only pages ensure the library, sessions, and admin UI never go stale.
    event.respondWith(fetch(new Request(request, { cache: "no-store" })).catch(async () => {
      const offline = await caches.match(OFFLINE_URL);
      return offline || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }));
    return;
  }

  // Cache only immutable build assets and the app's own static icons.
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/icons/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  })());
});


// Browser Push can wake this service worker while the PWA is closed.
// Only display a small, user-visible message; never fetch private APIs here.
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let item = {};
    try { item = event.data ? event.data.json() : {}; }
    catch { item = {}; }
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 100) : "";
    const season = Number.isSafeInteger(item.season) && item.season > 0 ? item.season : null;
    const episode = Number.isSafeInteger(item.episode) && item.episode > 0 ? item.episode : null;
    const id = Number.isSafeInteger(item.id) && item.id > 0 ? item.id : null;
    const route = typeof item.url === "string" && /^\/(?:anime|series)\/[a-z0-9_-]+(?:#episode-\d+)?$/i.test(item.url)
      ? item.url : "/notifications";
    await self.registration.showNotification(title ? "Vault · " + title : "Vault · New episode", {
      body: season && episode ? "New episode available: Season " + season + ", Episode " + episode : "New episode available.",
      tag: id ? "vault-episode-" + id : "vault-episode-update",
      icon: "/icons/icon-192.png",
      data: { url: route },
    });
  })());
});

// Foreground opt-in notifications use the existing PWA registration.
// A real push subscription/server is required for alerts while the app is closed.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const given = event.notification.data && event.notification.data.url;
  const route = typeof given === "string" && /^\/(?:anime|series|movie)\/[a-z0-9_-]+(?:#episode-\d+)?$/i.test(given)
    ? given : "/notifications";
  event.waitUntil((async () => {
    const target = new URL(route, self.location.origin).href;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        if ("navigate" in client) await client.navigate(target);
        if ("focus" in client) return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
