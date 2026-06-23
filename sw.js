// Routines service worker.
// Bump CACHE_VERSION on every deploy so old caches are purged.
const CACHE_VERSION = "routines-v8";

// App shell precached on install. index.html is fetched network-first below,
// so a stale copy here is only ever a last-resort offline fallback.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./liftdash_icon-192.png",
  "./liftdash_icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache Drive API writes

  const url = new URL(req.url);

  // Never touch Google APIs / sign-in — always go straight to the network.
  if (/(googleapis\.com|accounts\.google\.com|gstatic\.com)/.test(url.host)) {
    return;
  }

  const isShellDoc =
    req.mode === "navigate" ||
    (url.origin === self.location.origin && /\/(index\.html)?$/.test(url.pathname));

  if (isShellDoc) {
    // Network-first: edits to index.html propagate without a reinstall.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Everything else (icons, Chart.js CDN): cache-first, fill cache on first online hit.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
