// iDeliveryFood Customer Web PWA Service Worker (M05 / M23 Security Policy)
// Strictly caches ONLY public static shell assets. Never caches authenticated /v1/me, /v1/orders, /v1/quotes, or /v1/payments responses.

const PUBLIC_STATIC_CACHE = "ideliveryfood-public-static-v1";
const PUBLIC_STATIC_ASSETS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PUBLIC_STATIC_CACHE).then((cache) => cache.addAll(PUBLIC_STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== PUBLIC_STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PURGE_AUTH_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PUBLIC_STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  // Never cache API endpoints, authenticated routes, or dynamic user data
  if (
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/orders/") ||
    url.pathname.startsWith("/checkout") ||
    url.pathname.startsWith("/profile") ||
    url.pathname.startsWith("/addresses") ||
    request.headers.get("Authorization")
  ) {
    return;
  }

  if (PUBLIC_STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
