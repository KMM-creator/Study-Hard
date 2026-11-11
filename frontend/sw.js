/* =====================================================================
   sw.js — Service Worker (кладётся в ту же папку, что и index.html,
   и должен отдаваться по адресу /sw.js)

   Почему это важно: старый sw.js, скорее всего, хранил копию сайта и
   отдавал её вместо новых файлов — отсюда «вечный кэш».
   Этот работает по принципу «сначала сеть, кэш — только если нет интернета»,
   а запросы к /api/ вообще не трогает.

   Если когда-нибудь снова что-то «залипнет» — просто поменяй цифру в CACHE.
   ===================================================================== */
const CACHE = 'study-hard-20261112-1';

self.addEventListener('install', (event) => {
    self.skipWaiting();   // новая версия включается сразу
    event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).catch(() => {}));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Не вмешиваемся: не-GET, чужие сайты (шрифты), API
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
}); 
