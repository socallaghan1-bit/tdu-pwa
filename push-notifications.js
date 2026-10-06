// Anonymous Web Push subscriptions. No login required: the browser's push
// subscription itself is the only identifier sent to the configured backend.
(function () {
    const ENDPOINT_KEY = 'tduPushEndpoint';
    const REQUEST_TIMEOUT_MS = 10000;

    let isBusy = false;
    let isSubscribed = false;

    function getElement(id) {
        return document.getElementById(id);
    }

    function resolveBackendUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw, window.location.href);
            if (url.protocol === 'https:' || url.origin === window.location.origin) return url.href;
        } catch (error) {
            // Invalid URL: treat as not configured.
        }
        return '';
    }

    function getPushConfig() {
        const config = window.TDU_PUSH_CONFIG || {};
        const vapidPublicKey = String(config.vapidPublicKey || '').trim();
        return {
            vapidPublicKey: /^[A-Za-z0-9_-]{86,88}={0,2}$/.test(vapidPublicKey) ? vapidPublicKey : '',
            subscriptionUrl: resolveBackendUrl(config.subscriptionUrl)
        };
    }

    function isConfigured(config) {
        return Boolean(config.vapidPublicKey && config.subscriptionUrl);
    }

    function isPushSupported() {
        return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
    }

    function hasSameServerKey(subscription, key) {
        const current = subscription.options && subscription.options.applicationServerKey;
        if (!current) return true;
        const currentBytes = new Uint8Array(current);
        const expectedBytes = urlBase64ToUint8Array(key);
        return currentBytes.length === expectedBytes.length && currentBytes.every((byte, index) => byte === expectedBytes[index]);
    }

    function setStatus(message) {
        const status = getElement('push-status');
        if (status) status.textContent = message || '';
    }

    function updateControls({ disabled = false } = {}) {
        const button = getElement('push-toggle-btn');
        if (button) {
            button.disabled = disabled || isBusy;
            button.textContent = isSubscribed ? 'On' : 'Off';
            button.setAttribute('aria-checked', String(isSubscribed));
        }
    }

    async function fetchWithTimeout(url, options) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
        try {
            return await fetch(url, { ...options, signal: controller ? controller.signal : undefined });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function sendSubscription(config, subscription) {
        const response = await fetchWithTimeout(config.subscriptionUrl, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription.toJSON())
        });
        if (!response.ok) throw new Error(`Subscription backend responded ${response.status}`);
    }

    async function removeSubscriptionFromBackend(config, subscription) {
        const response = await fetchWithTimeout(config.subscriptionUrl, {
            method: 'DELETE',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        if (!response.ok) throw new Error(`Subscription backend responded ${response.status}`);
    }

    async function getRegistration() {
        let timer;
        try {
            return await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Service worker not ready')), REQUEST_TIMEOUT_MS);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function subscribeAndRegister(config) {
        const registration = await getRegistration();
        let subscription = await registration.pushManager.getSubscription();

        if (subscription && !hasSameServerKey(subscription, config.vapidPublicKey)) {
            await subscription.unsubscribe();
            subscription = null;
        }

        const isNew = !subscription;
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
            });
        }

        try {
            await sendSubscription(config, subscription);
        } catch (error) {
            if (isNew) await subscription.unsubscribe().catch(() => {});
            throw error;
        }

        localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
        return subscription;
    }

    async function enableAlerts(config) {
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') {
            setStatus(permission === 'denied'
                ? 'Notifications are blocked in your browser settings.'
                : 'Alerts not enabled. You can turn them on any time.');
            return;
        }

        await subscribeAndRegister(config);
        isSubscribed = true;
        setStatus('Notifications active on this device.');
        if (typeof trackAnalyticsEvent === 'function') {
            trackAnalyticsEvent('enable_push_alerts');
        }

        if (window.TDUCelebrate) {
            window.TDUCelebrate.success();
            window.TDUCelebrate.lottieSuccess(getElement('push-success-animation'));
        }
    }

    async function disableAlerts(config) {
        const registration = await getRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            try {
                await removeSubscriptionFromBackend(config, subscription);
            } catch (error) {
                console.warn('Could not remove push subscription from backend:', error);
            }
            await subscription.unsubscribe();
        }
        localStorage.removeItem(ENDPOINT_KEY);
        isSubscribed = false;
        setStatus('');
        if (typeof trackAnalyticsEvent === 'function') {
            trackAnalyticsEvent('disable_push_alerts');
        }
    }

    window.togglePushAlerts = async function () {
        const config = getPushConfig();
        if (isBusy || !isPushSupported() || !isConfigured(config)) return;

        isBusy = true;
        updateControls();
        setStatus(isSubscribed ? 'Turning off alerts…' : 'Setting up alerts…');
        try {
            if (isSubscribed) {
                await disableAlerts(config);
            } else {
                await enableAlerts(config);
            }
        } catch (error) {
            console.error('Push subscription error:', error);
            setStatus('Could not update alerts right now. Please check your connection and try again.');
        } finally {
            isBusy = false;
            updateControls();
        }
    };

    async function initPushAlerts() {
        const panel = getElement('push-panel');
        if (!panel) return;

        const config = getPushConfig();
        if (!isPushSupported()) {
            const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isStandalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
            setStatus(isAppleMobile && !isStandalone
                ? 'On iPhone or iPad, add TDU 2027 to your Home Screen first (iOS 16.4+), then enable alerts here.'
                : 'Race alerts are not supported in this browser.');
            updateControls({ disabled: true });
            return;
        }
        if (!isConfigured(config)) {
            setStatus('');
            updateControls({ disabled: true });
            return;
        }
        if (Notification.permission === 'denied') {
            setStatus('Notifications are blocked in your browser settings.');
            updateControls({ disabled: true });
            return;
        }

        updateControls({ disabled: true });
        try {
            const registration = await getRegistration();
            let subscription = await registration.pushManager.getSubscription();
            const storedEndpoint = localStorage.getItem(ENDPOINT_KEY);

            if (Notification.permission === 'granted' && storedEndpoint
                && (!subscription || subscription.endpoint !== storedEndpoint || !hasSameServerKey(subscription, config.vapidPublicKey))) {
                subscription = await subscribeAndRegister(config);
            }

            isSubscribed = Boolean(subscription && localStorage.getItem(ENDPOINT_KEY) === subscription.endpoint);
            setStatus(isSubscribed ? 'Notifications active on this device.' : '');
        } catch (error) {
            console.warn('Push status check failed:', error);
            setStatus('');
        }
        updateControls();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPushAlerts, { once: true });
    } else {
        initPushAlerts();
    }
}());
