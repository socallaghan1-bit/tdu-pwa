# tdu-pwa
Your interactive Adelaide Tour Down Under companion. Explore every street party, pop-up group ride, and race stage in one fast, mobile-first PWA. Easily build a custom 'My TDU' itinerary, sync events to your phone calendar in one tap, check live Adelaide weather overlays, and access Strava route files—offline-ready with zero logins required!

## Backlog additions
- [x] Add optional sound or audio feedback for key in-app actions (synthesized via Web Audio API, with header toggle).
- [x] Add opt-in push notifications for important event reminders and updates (see Web Push setup below).
- Future note: keep the event schema flexible enough to support other multi-day event guides, such as an April 2027 Gather Round style experience.

## Analytics note
- GA4 pageviews are sent manually for this SPA so Home, Schedule, and My TDU do not double-count virtual navigation.
- If GA4 Enhanced Measurement browser-history pageviews are enabled for the web stream, disable that setting to avoid duplicate pageviews.
- If analytics collection is enabled on the live site, disclose it in the appropriate privacy notice for the app/site.

## CDNJS libraries
- Third-party libraries load on demand from CDNJS via `cdn-libs.js`, with SRI `integrity` and `crossorigin="anonymous"`: canvas-confetti 1.9.3 (calendar export celebration), Leaflet 1.9.4 + leaflet-ant-path 1.3.0 (stage maps), Chart.js 4.4.1 (checkpoint elevation profile), GSAP 3.12.5 + ScrollTrigger (schedule card reveal, skipped for reduced motion/Save-Data), and lottie-web 5.12.2 light build (alerts success animation).
- The service worker serves `cdnjs.cloudflare.com` requests Cache First with network fallback from a separate `tdu-cdnjs-v*` cache. CDNJS URLs are version-pinned, so bump the library URL/SRI in `cdn-libs.js` (and the cache name if needed) when upgrading.
- Every library is optional: if one fails to load (offline, SRI mismatch), the related feature degrades quietly. If leaflet-ant-path is unavailable, stage maps fall back to a dashed Leaflet polyline.
- Haptics: `navigator.vibrate(12)` only on page/stage tab navigation and `[15, 50, 15]` only on success milestones (calendar export, alerts enabled). Never on scroll, hover, or minor clicks.

## Web Push setup
1. Generate a VAPID key pair on your server (e.g. `npx web-push generate-vapid-keys`). Keep the **private key on the server only**.
2. In `index.html`, set `window.TDU_PUSH_CONFIG.vapidPublicKey` to the public key and `subscriptionUrl` to your backend endpoint (HTTPS or same-origin). Leave either blank and the app shows "Race alerts are coming soon" instead of subscribing.
3. The backend should accept:
   - `POST` JSON `{ "subscription": PushSubscriptionJSON, "topics": ["stage-updates" | "evening-recaps" | "womens-tour" | "mens-tour"], "locale": "en-AU" }` to create/update an anonymous subscription (upsert by `subscription.endpoint`). Return 2xx.
   - `DELETE` JSON `{ "endpoint": "..." }` to remove it. Also prune endpoints that return 404/410 when sending.
   - Allow CORS from the app origin if the backend is on another domain. No cookies or login are used.
4. Send pushes with your VAPID private key (e.g. the `web-push` library). Payload JSON:
   ```json
   {
     "title": "Stage 3 replay is live",
     "body": "Watch the finale in Uraidla.",
     "imageUrl": "https://example.com/stage-3-hero.jpg",
     "stageId": "2027-men-3",
     "url": "https://tourdownunder.com.au/race/stages/...",
     "replayUrl": "https://tourdownunder.com.au/...",
     "standingsUrl": "https://tourdownunder.com.au/..."
   }
   ```
   Notifications use `icons/tdu-badge.png` as icon and badge and show **Watch Replay** / **View Standings** actions. Links must be on the app origin or `tourdownunder.com.au` (edit `ALLOWED_LINK_HOSTS` in `service-worker.js` to add hosts); anything else falls back to the in-app stage card (`index.html?event=<stageId>`). Images must be HTTPS.
- iPhone/iPad support Web Push only after the app is added to the Home Screen (iOS 16.4+).
