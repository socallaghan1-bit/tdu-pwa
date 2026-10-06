const CACHE_NAME = 'tdu-pwa-v12'; // Bumped version to force cache refresh
// CDNJS assets are version-pinned in their URLs, so they live in their own cache that survives app updates.
const CDN_CACHE_NAME = 'tdu-cdnjs-v1';
const CDN_CACHE_MAX_ENTRIES = 60;
const CDNJS_ORIGIN = 'https://cdnjs.cloudflare.com';
const KEEP_CACHES = [CACHE_NAME, CDN_CACHE_NAME];
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './cdn-libs.js',
    './stage-map.js',
    './push-notifications.js',
    './events.json',
    './manifest.json',
    './icons/tdu-badge.png',
    './animations/success-check.json',
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

    if (requestUrl.pathname.endsWith('/events.json')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./events.json', copy));
                    return response;
                })
                .catch(() => caches.match('./events.json'))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
            .then((cached) => cached || fetch(event.request))
    );
});

// ---- Web Push ----

const NOTIFICATION_ICON = new URL('icons/tdu-badge.png', self.registration.scope).href;
const DEFAULT_NOTIFICATION_TITLE = 'TDU 2027';
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
    const data = parsePushPayload(event);
    
    // Fallback variables matching both old and new payload structures
    const stageId = cleanText(data.stageId, 64).replace(/[^A-Za-z0-9_-]/g, '');
    const appUrl = getAppEventUrl(stageId);
    
    // Check both targetUrl (from new admin.html) and url (from original spec)
    const rawTarget = data.targetUrl || data.url;
    const videoUrl = safeUrl(rawTarget, { allowExternal: true }) || appUrl;
    
    const replayUrl = safeUrl(data.replayUrl, { allowExternal: true }) || videoUrl;
    const standingsUrl = safeUrl(data.standingsUrl, { allowExternal: true }) || appUrl;
    const imageUrl = safeUrl(data.imageUrl, { allowExternal: 'any' });
    const tag = cleanText(data.tag, 64) || (stageId ? `stage-${stageId}` : 'tdu-alert-' + Date.now());
    const title = cleanText(data.title, 120) || DEFAULT_NOTIFICATION_TITLE;

    const options = {
        body: cleanText(data.body, 300),
        icon: data.icon || NOTIFICATION_ICON,
        badge: data.badge || NOTIFICATION_ICON, // Monochrome badge on Android
        vibrate: [200, 100, 200, 100, 200], // Forces high-priority banner on Android
        tag,
        renotify: true, // Forces sound/vibration even if a previous alert is still sitting in the tray
        data: { url: videoUrl, replayUrl, standingsUrl },
        actions: data.actions || [
            { action: 'open', title: '🚴 Open Stage' }
        ]
    };

    if (imageUrl) options.image = imageUrl;

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

async function openOrFocus(targetUrl) {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(targetUrl, self.registration.scope);

    if (target.origin === self.location.origin) {
        // Find exact match
        const exact = windowClients.find((client) => client.url === target.href);
        if (exact) {
            exact.focus();
            return;
        }

        // Find any open app instance and navigate it
        const appClient = windowClients.find((client) => new URL(client.url).origin === target.origin);
        if (appClient && 'navigate' in appClient) {
            const navigated = await appClient.navigate(target.href).catch(() => null);
            if (navigated) {
                navigated.focus();
                return;
            }
        }
    }

    // Fallback: open a new window
    return self.clients.openWindow(target.href);
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    let targetUrl = data.url;
    
    if (event.action === 'watch-replay') targetUrl = data.replayUrl;
    if (event.action === 'view-standings') targetUrl = data.standingsUrl;
    if (event.action === 'watch') targetUrl = `${data.url}?tab=recap`; // legacy action support

    // Ensure we don't open 'undefined'
    const safeTarget = safeUrl(targetUrl, { allowExternal: true }) || getAppEventUrl('');
    event.waitUntil(openOrFocus(safeTarget));
});
