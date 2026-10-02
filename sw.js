// Spotlog Europa service worker: app shell offline, map tiles cached, live data always fresh.
const VERSION = "spotlog-v1";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];
const TILE_CACHE = "spotlog-tiles", TILE_MAX = 1500;
const LIVE = ["api.adsb.lol", "api.airplanes.live", "api.adsbdb.com", "api.planespotters.net"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles() {
  const c = await caches.open(TILE_CACHE); const keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (LIVE.includes(url.hostname)) return; // live data: straight to the network
  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }
  if (url.origin === location.origin || url.hostname === "cdnjs.cloudflare.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    // stale-while-revalidate
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
