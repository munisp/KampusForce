const CACHE = "kampusforce-shell-v7";
const CORE = ["/", "/manifest.webmanifest", "/icons/kf.svg"];

function isPrivateOrRedirectPath(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/v1/") || pathname.startsWith("/l/") || pathname.startsWith("/p/") || pathname === "/recruit/accept";
}

async function cacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch("/", { cache: "no-store" });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("text/html")) {
    throw new Error("Unable to cache the application shell");
  }
  const html = await response.clone().text();
  await cache.put("/", response);
  const discovered = [...html.matchAll(/\b(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
  await cache.addAll([...new Set([...CORE.filter((path) => path !== "/"), ...discovered])]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_FIRST_VISIT_RESOURCES" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.slice(0, 200).map((value) => new URL(value, self.location.origin)).filter((url) =>
    url.origin === self.location.origin && !url.search && !isPrivateOrRedirectPath(url.pathname)
  );
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateOrRedirectPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const contentType = response.headers.get("content-type") || "";
      // Only an ordinary, non-redirected application document may replace the
      // offline shell. Vendor redirects and token-bearing URLs are never cached.
      if (!url.search && response.ok && !response.redirected && response.type === "basic" && contentType.includes("text/html")) {
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put("/", response.clone())));
      }
      return response;
    }).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (!url.search && response.ok && response.type === "basic") {
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
    }
    return response;
  })));
});
