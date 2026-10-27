// Offline support: keeps a copy of the site so tools work without internet.
// Bump CACHE when you deploy changes so visitors get the new files.
const CACHE = 'safemerge-v3';
const FILES = [
  '/', '/merge-pdf/', '/compress-pdf/', '/resize-image/', '/split-pdf/', '/rotate-pdf/', '/organize-pdf/', '/jpg-to-pdf/',
  '/pdf-to-jpg/', '/add-page-numbers/', '/watermark-pdf/', '/privacy/',
  '/assets/css/site.css?v=3', '/assets/img/icon.svg', '/manifest.webmanifest',
  '/assets/js/config.js?v=3', '/assets/js/monetize.js?v=3', '/assets/js/core.js?v=3',
  '/assets/js/tools/merge.js?v=3', '/assets/js/tools/split.js?v=3', '/assets/js/tools/pages.js?v=3',
  '/assets/js/tools/images-to-pdf.js?v=3', '/assets/js/tools/pdf-to-images.js?v=3', '/assets/js/tools/stamp.js?v=3', '/assets/js/tools/compress.js?v=3', '/assets/js/tools/resize-image.js?v=3',
  '/vendor/pdf-lib/pdf-lib.min.js', '/vendor/pdfjs/pdf.min.js', '/vendor/pdfjs/pdf.worker.min.js',
  '/vendor/jszip/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-site files only: network first so updates show up, cache when offline.
// Ad scripts from other sites are never cached or touched.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
