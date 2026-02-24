const APP_VERSION = new URL(self.location.href).searchParams.get("v") || "0.1";
const CACHE_NAME = `coffeelog-shell-v${APP_VERSION}`;
const VERSION_QUERY = `?v=${encodeURIComponent(APP_VERSION)}`;
const APP_SHELL = [
  "/",
  "/create",
  "/view",
  "/settings",
  `/static/css/styles.css${VERSION_QUERY}`,
  `/static/css/colors.css${VERSION_QUERY}`,
  `/static/css/typo.css${VERSION_QUERY}`,
  `/static/js/app.js${VERSION_QUERY}`,
  `/static/js/idb.js${VERSION_QUERY}`,
  `/static/data/taste_tags.json${VERSION_QUERY}`,
  `/manifest.json${VERSION_QUERY}`,
  `/static/icons/brew-method/espresso.png${VERSION_QUERY}`,
  `/static/icons/brew-method/v60.png${VERSION_QUERY}`,
  `/static/icons/brew-method/aeropress.png${VERSION_QUERY}`,
  `/static/icons/brew-method/chemex.png${VERSION_QUERY}`,
  `/static/icons/brew-method/french-press.png${VERSION_QUERY}`,
  `/static/icons/brew-method/cupping.png${VERSION_QUERY}`,
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isNavigation = request.mode === "navigate";

  if (request.method !== "GET") {
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(
        fetch(request).catch(() =>
          new Response(JSON.stringify({ detail: "Offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        )
      );
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        })
    );
    return;
  }

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, copy));
          return response;
        })
        .catch(async () => {
          const routeCached = await caches.match(url.pathname);
          if (routeCached) return routeCached;
          const rootCached = await caches.match("/");
          if (rootCached) return rootCached;
          return new Response("Offline", { status: 503 });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("/"));
    })
  );
});
