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

// Standard Web Push: keep the existing install/offline/static-cache handlers.
self.addEventListener("push", (event) => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!data || typeof data.title !== "string" || typeof data.body !== "string" || !Number.isSafeInteger(data.notificationId) || data.notificationId < 1) return;
  let target;
  try { target = new URL(data.url, self.location.origin); } catch { return; }
  if (target.origin !== self.location.origin || !/^\/(anime|series)\/[^/]+$/.test(target.pathname) || !/^#episode-\d+$/.test(target.hash)) return;
  event.waitUntil(self.registration.showNotification(data.title.slice(0, 255), {
    body: data.body.slice(0, 600), icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    tag: `vault-episode-${data.notificationId}`, renotify: false,
    data: { url: target.href, notificationId: data.notificationId },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    let target;
    try { target = new URL(data?.url, self.location.origin); } catch { return; }
    if (target.origin !== self.location.origin || !/^\/(anime|series)\/[^/]+$/.test(target.pathname) || !/^#episode-\d+$/.test(target.hash)) return;
    // Navigate immediately even when marking read is slow/offline. Keep any
    // admin tab intact rather than discarding an in-progress editing workflow.
    const read = Number.isSafeInteger(data?.notificationId)
      ? fetch("/api/notifications", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: data.notificationId }) }).catch(() => undefined)
      : Promise.resolve();
    const navigate = (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => {
        const url = new URL(client.url);
        return url.origin === target.origin && !/^\/(admin|api)(\/|$)/.test(url.pathname);
      });
      if (existing && "navigate" in existing) {
        try {
          const navigated = await existing.navigate(target.href);
          if (navigated) { await navigated.focus(); return; }
        } catch { /* Closed/racing clients fall back to a new public tab. */ }
      }
      await self.clients.openWindow(target.href);
    })();
    await Promise.all([read, navigate]);
  })());
});
