const CACHE = "qcm-audi-v8";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./questions.json",
  "./manifest.json",
  "./sw.js",
  "./background.jpg",
  "./beep.mp3"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // on tente de tout mettre en cache ; si un fichier manque, on n'empêche pas l'app de s'installer
      await Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch(() => null)
        )
      );
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});