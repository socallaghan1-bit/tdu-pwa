// Anonymous Web Push subscriptions with topic tags. No login: the browser's push
// subscription itself is the only identifier sent to the configured backend.
(function () {
    const PUSH_TOPICS = [
        { id: 'stage-updates', label: 'Stage updates' },
        { id: 'evening-recaps', label: 'Evening recaps' },
        { id: 'womens-tour', label: "Women's tour" },
        { id: 'mens-tour', label: "Men's tour" }
    ];
    const VALID_TOPIC_IDS = PUSH_TOPICS.map((topic) => topic.id);
    const TOPICS_KEY = 'tduPushTopics';
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
            // A P-256 public key is 65 bytes, i.e. 87 base64url characters (88 with padding).
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

    function getStoredTopics() {
        try {
            const stored = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
            if (Array.isArray(stored)) return stored.filter((topic) => VALID_TOPIC_IDS.includes(topic));
        } catch (error) {
            // Fall through to defaults.
        }
        return null;
    }

    function getSelectedTopics() {
        return Array.from(document.querySelectorAll('#push-topic-list input[type="checkbox"]'))
            .filter((input) => input.checked && VALID_TOPIC_IDS.includes(input.value))
            .map((input) => input.value);
    }

    function setStatus(message) {
        const status = getElement('push-status');
        if (status) status.textContent = message;
    }

    function updateControls({ disabled = false } = {}) {
        const button = getElement('push-toggle-btn');
        if (button) {
            button.disabled = disabled || isBusy;
            button.textContent = isSubscribed ? 'Turn off alerts' : 'Enable alerts';
            button.setAttribute('aria-pressed', String(isSubscribed));
        }
        document.querySelectorAll('#push-topic-list input').forEach((input) => {
            input.disabled = disabled || isBusy;
        });
    }

    function renderTopics() {
        const list = getElement('push-topic-list');
        if (!list) return;
        const selected = getStoredTopics() || VALID_TOPIC_IDS;
        list.innerHTML = PUSH_TOPICS.map((topic) => `
            <label class="push-topic">
                <input type="checkbox" value="${topic.id}" ${selected.includes(topic.id) ? 'checked' : ''} onchange="handlePushTopicChange()">
                <span>${escapeHTML(topic.label)}</span>
            </label>
        `).join('');
    }

    function describeTopics(topics) {
        return PUSH_TOPICS.filter((topic) => topics.includes(topic.id)).map((topic) => topic.label).join(', ');
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

    async function sendSubscription(config, subscription, topics) {
        const response = await fetchWithTimeout(config.subscriptionUrl, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                topics,
                locale: navigator.language || ''
            })
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

    async function subscribeAndRegister(config, topics) {
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
            await sendSubscription(config, subscription, topics);
        } catch (error) {
            // Don't leave an orphaned browser subscription the backend never saw.
            if (isNew) await subscription.unsubscribe().catch(() => {});
            throw error;
        }

        localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
        localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
        return subscription;
    }

    async function enableAlerts(config) {
        const topics = getSelectedTopics();
        if (!topics.length) {
            setStatus('Pick at least one topic first.');
            return;
        }

        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') {
            setStatus(permission === 'denied'
                ? 'Notifications are blocked. Allow them in your browser settings to get race alerts.'
                : 'Alerts not enabled. You can turn them on any time.');
            return;
        }

        await subscribeAndRegister(config, topics);
        isSubscribed = true;
        setStatus(`Alerts on: ${describeTopics(topics)}.`);
        trackAnalyticsEvent('enable_push_alerts', { topic_count: topics.length });

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
                // The push service rejects sends to an unsubscribed endpoint, so the backend can prune it later.
                console.warn('Could not remove push subscription from backend:', error);
            }
            await subscription.unsubscribe();
        }
        localStorage.removeItem(ENDPOINT_KEY);
        isSubscribed = false;
        setStatus('Alerts are off.');
        trackAnalyticsEvent('disable_push_alerts');
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

    let topicSyncTimer = null;
    window.handlePushTopicChange = function () {
        const topics = getSelectedTopics();
        if (!isSubscribed) {
            localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
            return;
        }
        if (!topics.length) {
            setStatus('Pick at least one topic, or turn off alerts.');
            return;
        }

        clearTimeout(topicSyncTimer);
        topicSyncTimer = setTimeout(async () => {
            const config = getPushConfig();
            if (isBusy || !isConfigured(config)) return;
            isBusy = true;
            updateControls();
            try {
                await subscribeAndRegister(config, topics);
                setStatus(`Alerts on: ${describeTopics(topics)}.`);
            } catch (error) {
                console.error('Push topic update error:', error);
                setStatus('Could not save your topics. Please try again.');
            } finally {
                isBusy = false;
                updateControls();
            }
        }, 600);
    };

    async function initPushAlerts() {
        const panel = getElement('push-panel');
        if (!panel) return;
        renderTopics();

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
            setStatus('Race alerts are coming soon.');
            updateControls({ disabled: true });
            return;
        }
        if (Notification.permission === 'denied') {
            setStatus('Notifications are blocked. Allow them in your browser settings to get race alerts.');
            updateControls({ disabled: true });
            return;
        }

        updateControls({ disabled: true });
        try {
            const registration = await getRegistration();
            let subscription = await registration.pushManager.getSubscription();
            const storedTopics = getStoredTopics();
            const storedEndpoint = localStorage.getItem(ENDPOINT_KEY);

            // Re-register if the push service rotated or expired the subscription since the last visit.
            if (Notification.permission === 'granted' && storedTopics && storedTopics.length && storedEndpoint
                && (!subscription || subscription.endpoint !== storedEndpoint || !hasSameServerKey(subscription, config.vapidPublicKey))) {
                subscription = await subscribeAndRegister(config, storedTopics);
            }

            isSubscribed = Boolean(subscription && localStorage.getItem(ENDPOINT_KEY) === subscription.endpoint);
            setStatus(isSubscribed ? `Alerts on: ${describeTopics(storedTopics || [])}.` : 'Choose topics and enable alerts. No login needed.');
        } catch (error) {
            console.warn('Push status check failed:', error);
            setStatus('Choose topics and enable alerts. No login needed.');
        }
        updateControls();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPushAlerts, { once: true });
    } else {
        initPushAlerts();
    }
}());
