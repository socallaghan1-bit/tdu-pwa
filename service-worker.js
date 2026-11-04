const CACHE_NAME = 'mytdu-cache-v20'; // Bumped cache version to ensure immediate update
// CDNJS assets are version-pinned in their URLs, so they live in their own cache that survives app updates.
const CDN_CACHE_NAME = 'tdu-cdnjs-v1';
const CDN_CACHE_MAX_ENTRIES = 60;
const CDNJS_ORIGIN = 'https://cdnjs.cloudflare.com';
const KEEP_CACHES = [CACHE_NAME, CDN_CACHE_NAME];
const NETWORK_FIRST_DATA = ['./events.json', './facilities.json'];
// Stage GPX files are precached for roadside offline downloads but refreshed network-first when traces are updated.
const GPX_ROUTES = ['./routes/stage-1.gpx', './routes/stage-2.gpx', './routes/stage-3.gpx', './routes/stage-4.gpx', './routes/stage-5.gpx', './routes/stage-6.gpx'];
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './cdn-libs.js',
    './stage-map.js',
    './push-notifications.js',
    './events.json',
    './facilities.json',
    './manifest.json',
    './icons/tdu-badge.png',
    './animations/success-check.json',
    ...GPX_ROUTES,
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => !KEEP_CACHES.includes(key)).map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

// Cache First, Network Fallback for CDNJS libraries, stylesheets, and fonts.
async function cdnCacheFirst(event) {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    // Only cache successful CORS/basic responses; opaque responses can't be validated and bloat quota.
    if (response.ok && response.type !== 'opaque') {
        const copy = response.clone();
        event.waitUntil(
            caches.open(CDN_CACHE_NAME)
                .then((cache) => cache.put(event.request, copy))
                .then(() => trimCache(CDN_CACHE_NAME, CDN_CACHE_MAX_ENTRIES))
                .catch(() => {})
        );
    }
    return response;
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);

    if (requestUrl.origin === CDNJS_ORIGIN) {
        event.respondWith(cdnCacheFirst(event));
        return;
    }

    // Network First for frequently updated data files and GPX routes, falling back to the offline copy.
    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isGpxRoute = isSameOrigin && /\/routes\/[A-Za-z0-9_-]+\.gpx$/.test(requestUrl.pathname);
    const dataFile = isGpxRoute
        ? `.${requestUrl.pathname.slice(requestUrl.pathname.lastIndexOf('/routes/'))}`
        : NETWORK_FIRST_DATA.find((file) => requestUrl.pathname.endsWith(file.slice(1)));
    if (dataFile) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(dataFile, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(dataFile))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then((cached) => cached || fetch(event.request))
    );
});

// ---- Web Push ----

// Spec'd assets (icons/icon-192x192.png, icons/badge-72x72.png) fall back to the bundled badge until they're added.
const NOTIFICATION_ICON = new URL('icons/tdu-badge.png', self.registration.scope).href;
const NOTIFICATION_BADGE = NOTIFICATION_ICON;
const DEFAULT_NOTIFICATION_TITLE = 'Santos Tour Down Under Alert';
// Deep links must stay on this app or the official TDU site so a push payload can't open arbitrary pages.
const ALLOWED_LINK_HOSTS = ['tourdownunder.com.au'];

function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeUrl(value, { allowExternal }) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, self.registration.scope);
        if (url.origin === self.location.origin) return url.href;
        if (!allowExternal || url.protocol !== 'https:') return '';
        if (allowExternal === 'any') return url.href;
        const host = url.hostname.toLowerCase();
        return ALLOWED_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? url.href : '';
    } catch (error) {
        return '';
    }
}

function getAppEventUrl(stageId) {
    const url = new URL('index.html', self.registration.scope);
    if (stageId) url.searchParams.set('event', stageId);
    return url.href;
}

function parsePushPayload(event) {
    if (!event.data) return {};
    try {
        const data = event.data.json();
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        return { body: event.data.text() };
    }
}

self.addEventListener('push', (event) => {
    if (!event.data) return;
    const data = parsePushPayload(event);

    const stageId = cleanText(data.stageId, 64).replace(/[^A-Za-z0-9_-]/g, '');
    // Accept both `url` and legacy `targetUrl` (sent by admin.html).
    const url = safeUrl(data.url || data.targetUrl, { allowExternal: true }) || safeUrl('./index.html', { allowExternal: false });
    const image = safeUrl(data.image || data.imageUrl, { allowExternal: 'any' }) || undefined;
    const icon = safeUrl(data.icon, { allowExternal: 'any' }) || NOTIFICATION_ICON;
    const tag = cleanText(data.tag, 64) || (stageId ? `stage-${stageId}` : 'tdu-race-alert');
    const title = cleanText(data.title, 120) || DEFAULT_NOTIFICATION_TITLE;
    const body = cleanText(data.body, 300);

    const options = {
        body,
        icon,
        badge: NOTIFICATION_BADGE,
        image, // Rich hero banner
        vibrate: [200, 100, 200, 100, 200], // Distinctive alert vibration
        tag,
        renotify: true,
        data: { url },
        actions: [
            { action: 'open_map', title: '🗺️ View Map' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    event.waitUntil((async () => {
        await self.registration.showNotification(title, options);

        // Broadcast to active app windows for in-app toast
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            client.postMessage({
                type: 'PUSH_RECEIVED',
                payload: { title, body, imageUrl: image || '', targetUrl: url }
            });
        }
    })());
});

async function focusOrOpen(targetUrl) {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(targetUrl, self.registration.scope);
    const client = target.origin === self.location.origin
        ? windowClients.find((c) => new URL(c.url).origin === target.origin)
        : null;

    if (client) {
        const focused = await client.focus().catch(() => client);
        if (client.url !== target.href && 'navigate' in focused) {
            await focused.navigate(target.href).catch(() => null);
        }
        return;
    }
    return self.clients.openWindow(target.href);
}

self.addEventListener('notificationclick', (event) => {
    const { notification } = event;
    notification.close();
    if (event.action === 'dismiss') return;

    const data = notification.data || {};
    const targetUrl = safeUrl(data.url, { allowExternal: true }) || getAppEventUrl('');
    event.waitUntil(focusOrOpen(targetUrl));
});
