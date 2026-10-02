let allEvents = [];
let currentDayFilter = 'All';
let currentCatFilter = 'All';
let deferredPrompt = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const ADELAIDE_COORDS = { latitude: -34.9285, longitude: 138.6007 };
const WEATHER_CACHE_KEY = 'tduWeatherSummaryV2';
const AUDIO_FEEDBACK_KEY = 'tduAudioFeedback';
let audioFeedbackContext = null;
const STANDALONE_LAUNCH_SESSION_KEY = 'tduStandaloneLaunchTracked';
const WEATHER_PLACEHOLDER = 'Today in Adelaide: Checking weather…';
const WEATHER_UNAVAILABLE = 'Weather unavailable';
const DEFAULT_RIDE_DISTANCE_KM = 45;
const DEFAULT_RIDE_ELEVATION_M = 0;
const RIDE_AVERAGE_SPEED_KMH = 23;
const RIDE_ELEVATION_PER_HOUR_M = 1000;
const RIDE_BUFFER_MINUTES = 30;
const BROUTER_MAP_CENTRE = '12/-34.85/138.80/standard';
const VIEW_ANALYTICS_CONFIG = {
    home: {
        page_title: 'TDU 2027 - Home',
        page_path: ''
    },
    schedule: {
        page_title: 'TDU 2027 - Schedule',
        page_path: 'schedule'
    },
    saved: {
        page_title: 'TDU 2027 - My TDU',
        page_path: 'my-tdu'
    }
};
const WEATHER_CODES = {
    0: 'Clear sky',
    1: 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Foggy',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Rain showers',
    82: 'Heavy showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorms',
    96: 'Thunderstorms',
    99: 'Thunderstorms'
};
const recommendationState = {
    isOpen: false,
    intent: '',
    option: ''
};
const activeViewEl = document.querySelector('.view.active');
let currentViewName = activeViewEl && activeViewEl.id ? activeViewEl.id.replace('view-', '') : 'home';
let hasTrackedInitialView = false;
let lastTrackedPageLocation = '';
const RECOMMENDATION_OPTIONS = {
    ride: [
        { id: 'hills', label: 'Hills' },
        { id: 'gravel', label: 'Gravel' },
        { id: 'easy-social', label: 'Easy & social' },
        { id: 'fast-flat', label: 'Fast/flat' }
    ],
    watch: [
        { id: 'climbing', label: 'Climbing' },
        { id: 'coastal', label: 'Coastal' },
        { id: 'city', label: 'City' },
        { id: 'any-stage', label: 'Any stage' }
    ],
    social: [
        { id: 'coffee', label: 'Coffee' },
        { id: 'beer-atmosphere', label: 'Beer/atmosphere' },
        { id: 'family-friendly', label: 'Family-friendly' },
        { id: 'featured', label: 'Featured' }
    ]
};
const INTENT_BUTTONS = [
    { id: 'ride', label: 'I want to ride' },
    { id: 'watch', label: 'I want to watch racing' },
    { id: 'social', label: 'I want something social' }
];

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).trim().split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
        }
    }
    return dateStr;
}

function timeToMinutes(timeStr) {
    if (typeof timeStr !== 'string') return null;
    const match = timeStr.trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3] ? match[3].toUpperCase() : '';

    if (meridiem) {
        if (hours < 1 || hours > 12) return null;
        hours = (hours % 12) + (meridiem === 'PM' ? 12 : 0);
    } else if (hours > 23) {
        return null;
    }

    return (hours * 60) + minutes;
}

function formatTime(timeStr) {
    const totalMinutes = timeToMinutes(timeStr);
    if (totalMinutes === null) return '';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

function formatTimeRange(startStr, endStr) {
    const start = formatTime(startStr);
    const end = formatTime(endStr);
    if (start && end) return `${start}–${end}`;
    return start || end;
}

function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getEventType(event) {
    if (event.type) return String(event.type);
    if (String(event.category || '').toLowerCase().includes('stage')) return 'Race Stage';
    return '';
}

function getEventRatingLabel(event) {
    const rating = event.tdu_rating;
    if (!rating) return '';
    if (typeof rating === 'string') return rating;
    if (typeof rating === 'object' && rating.label) return rating.label;
    return '';
}

function getEventRatingVibes(event) {
    const rating = getEventRatingLabel(event);
    if (!rating) return '';
    return rating.toLowerCase().includes('vibes') ? rating : `${rating} vibes`;
}

function getFeaturedReason(event) {
    return String(event.featured_reason || 'editorial').trim().toLowerCase();
}

function getSponsorName(event) {
    return String(event.sponsor_name || '').trim();
}

function trackAnalyticsEvent(eventName, params = {}) {
    if (typeof window.gtag !== 'function') return false;

    try {
        window.gtag('event', eventName, {
            app_name: 'TDU PWA',
            ...params
        });
        return true;
    } catch (error) {
        return false;
    }
}

function getVirtualPagePath(pagePath) {
    const url = new URL(window.location.href);
    const basePath = url.pathname.endsWith('/index.html')
        ? url.pathname.slice(0, -'index.html'.length)
        : (url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`);
    return pagePath ? `${basePath}${pagePath}` : basePath;
}

function getVirtualPageLocation(pagePath) {
    const url = new URL(window.location.href);
    return `${url.origin}${getVirtualPagePath(pagePath)}`;
}

function trackVirtualPageView(viewName) {
    const viewConfig = VIEW_ANALYTICS_CONFIG[viewName];
    if (!viewConfig) return false;

    const pageLocation = getVirtualPageLocation(viewConfig.page_path);
    const payload = {
        page_title: viewConfig.page_title,
        page_path: getVirtualPagePath(viewConfig.page_path),
        page_location: pageLocation
    };

    if (lastTrackedPageLocation && lastTrackedPageLocation !== pageLocation) {
        payload.page_referrer = lastTrackedPageLocation;
    }

    const tracked = trackAnalyticsEvent('page_view', payload);
    if (tracked) {
        lastTrackedPageLocation = pageLocation;
    }

    return tracked;
}

function isAllowedFeedbackUrl(urlValue) {
    try {
        const url = new URL(urlValue, window.location.href);
        return url.protocol === 'https:' && ['forms.gle', 'docs.google.com'].includes(url.hostname);
    } catch (error) {
        return false;
    }
}

function getEventAnalyticsPayload(eventId) {
    const event = allEvents.find((entry) => String(entry.id) === String(eventId));
    if (!event) {
        return { event_id: String(eventId) };
    }

    return {
        event_id: String(event.id || eventId),
        event_title: String(event.title || ''),
        event_category: String(event.category || getEventType(event) || '')
    };
}

function getEventStatus(event) {
    return String(event.status || 'scheduled').toLowerCase();
}

function getEventArea(location) {
    if (!location) return '';
    const parts = String(location).split(',').map((part) => part.trim()).filter(Boolean);
    return parts[parts.length - 1] || String(location).trim();
}

function getEventLocations(event) {
    const start = String(event.location || '').trim();
    const finish = String(event.finish_location || '').trim();

    if (!start && !finish) {
        return { start: '', finish: '', hasDistinctFinish: false };
    }

    if (!finish) {
        return { start, finish: '', hasDistinctFinish: false };
    }

    return {
        start: start || finish,
        finish,
        hasDistinctFinish: Boolean(start && finish && start !== finish)
    };
}

function getCalendarLocation(event) {
    const { start, finish, hasDistinctFinish } = getEventLocations(event);
    return hasDistinctFinish ? `Start: ${start} / Finish: ${finish}` : (start || finish);
}

function formatOptionLabel(optionId) {
    return String(optionId || '').replace(/-/g, ' ');
}

function getEventTags(event) {
    const tags = new Set(
        Array.isArray(event.tags)
            ? event.tags.map((tag) => String(tag).toLowerCase().trim()).filter(Boolean)
            : []
    );
    const text = `${event.category || ''} ${getEventType(event)} ${event.title || ''} ${event.description || ''} ${event.location || ''} ${event.finish_location || ''}`.toLowerCase();

    if (text.includes('stage')) tags.add('race');
    if (text.includes('hill') || text.includes('mount lofty') || text.includes('corkscrew') || text.includes('climb')) {
        tags.add('hills');
        tags.add('climbing');
    }
    if (text.includes('gravel')) tags.add('gravel');
    if (text.includes('coffee') || text.includes('cafe')) tags.add('coffee');
    if (text.includes('beer') || text.includes('bar') || text.includes('atmosphere')) tags.add('beer');
    if (text.includes('family')) tags.add('family');
    if (text.includes('social')) tags.add('social');
    if (text.includes('victor harbor') || text.includes('glenelg') || text.includes('henley beach') || text.includes('beach') || text.includes('coast')) {
        tags.add('coastal');
    }
    if (text.includes('norwood') || text.includes('campbelltown') || text.includes('city')) {
        tags.add('city');
    }
    if (event.featured) tags.add('featured');
    return Array.from(tags);
}

function isRideEvent(event) {
    const type = `${event.category || ''} ${getEventType(event)}`.toLowerCase();
    const tags = getEventTags(event);
    return type.includes('ride') || tags.some((tag) => ['ride', 'group ride', 'gravel', 'participatory'].includes(tag));
}

function isWatchEvent(event) {
    const type = `${event.category || ''} ${getEventType(event)}`.toLowerCase();
    return type.includes('stage') || getEventTags(event).includes('race');
}

function isSocialEvent(event) {
    const type = `${event.category || ''} ${getEventType(event)}`.toLowerCase();
    const tags = getEventTags(event);
    return type.includes('social')
        || type.includes('pop-up')
        || type.includes('family')
        || tags.some((tag) => ['social', 'coffee', 'beer', 'family', 'food', 'drink'].includes(tag));
}

function getSavedEvents() {
    try {
        return JSON.parse(localStorage.getItem('savedTDU') || '[]');
    } catch (error) {
        return [];
    }
}

function isAudioFeedbackEnabled() {
    try {
        return localStorage.getItem(AUDIO_FEEDBACK_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

function setAudioFeedbackEnabled(enabled) {
    try {
        localStorage.setItem(AUDIO_FEEDBACK_KEY, enabled ? 'true' : 'false');
    } catch (error) {
        // Ignore localStorage write errors.
    }
    updateSoundButtonUI(enabled);
}

function updateSoundButtonUI(enabled) {
    const btn = document.getElementById('header-sound-btn');
    const icon = document.getElementById('sound-btn-icon');
    if (!btn || !icon) return;

    if (enabled) {
        btn.classList.add('active');
        btn.setAttribute('aria-label', 'Sound feedback enabled. Click to mute.');
        btn.setAttribute('title', 'Sound feedback: On');
        icon.className = 'fas fa-volume-up';
    } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-label', 'Sound feedback muted. Click to enable.');
        btn.setAttribute('title', 'Sound feedback: Off');
        icon.className = 'fas fa-volume-mute';
    }
}

function getAudioFeedbackContext() {
    if (!audioFeedbackContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioFeedbackContext = new AudioContextClass();
        }
    }
    if (audioFeedbackContext && audioFeedbackContext.state === 'suspended') {
        audioFeedbackContext.resume();
    }
    return audioFeedbackContext;
}

function playAudioCue(type) {
    if (!isAudioFeedbackEnabled()) return;
    try {
        const ctx = getAudioFeedbackContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        if (type === 'save') {
            // Ascending cheerful chime (C5 -> G5)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.25);
        } else if (type === 'unsave') {
            // Gentle descending tone (D5 -> G4)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, now);
            osc.frequency.exponentialRampToValueAtTime(392.00, now + 0.15);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.22);
        } else if (type === 'export') {
            // Three-note celebratory arpeggio (C5, E5, G5)
            [523.25, 659.25, 783.99].forEach((freq, idx) => {
                const noteTime = now + (idx * 0.08);
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.12, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.25);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.25);
            });
        }
    } catch (e) {
        // Silently ignore audio playback errors
    }
}

window.toggleAudioFeedback = function() {
    const currentState = isAudioFeedbackEnabled();
    const newState = !currentState;
    setAudioFeedbackEnabled(newState);
    if (newState) {
        playAudioCue('save');
    }
    trackAnalyticsEvent('toggle_sound_feedback', { enabled: newState });
};

function renderWeatherWidget(message) {
    const widget = document.getElementById('weather-widget');
    if (!widget) return;

    widget.innerHTML = `
        <i class="fas fa-cloud-sun" aria-hidden="true"></i>
        <span>${escapeHTML(message)}</span>
    `;
}

function getCachedWeatherSummary() {
    try {
        return localStorage.getItem(WEATHER_CACHE_KEY) || '';
    } catch (error) {
        return '';
    }
}

function setCachedWeatherSummary(value) {
    try {
        localStorage.setItem(WEATHER_CACHE_KEY, value);
    } catch (error) {
        // Ignore localStorage write errors.
    }
}

function getWeatherCondition(code) {
    return WEATHER_CODES[Number(code)] || 'Conditions unavailable';
}

function getWindCompass(degrees) {
    if (!Number.isFinite(degrees)) return '';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
    return directions[index];
}

async function updateWeatherWidget() {
    const cachedWeather = getCachedWeatherSummary();
    renderWeatherWidget(cachedWeather || WEATHER_PLACEHOLDER);

    const params = new URLSearchParams({
        latitude: ADELAIDE_COORDS.latitude,
        longitude: ADELAIDE_COORDS.longitude,
        current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
        timezone: 'Australia/Adelaide'
    });

    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!response.ok) throw new Error('Weather request failed');

        const data = await response.json();
        const rawTemperature = data?.current?.temperature_2m;
        const rawWeatherCode = data?.current?.weather_code;
        const rawWindSpeed = data?.current?.wind_speed_10m;
        const rawWindDirection = data?.current?.wind_direction_10m;

        if (!Number.isFinite(Number(rawTemperature)) || !Number.isFinite(Number(rawWeatherCode))) {
            throw new Error('Weather data unavailable');
        }

        const temperature = Math.round(Number(rawTemperature));
        const weatherCode = Number(rawWeatherCode);
        let summary = `Today in Adelaide: ${temperature}°C • ${getWeatherCondition(weatherCode)}`;

        if (Number.isFinite(Number(rawWindSpeed)) && Number.isFinite(Number(rawWindDirection))) {
            const windSpeed = Math.round(Number(rawWindSpeed));
            const windDir = getWindCompass(Number(rawWindDirection));
            if (windDir) {
                summary += ` • Wind: ${windDir} ${windSpeed} km/h`;
            }
        }

        setCachedWeatherSummary(summary);
        renderWeatherWidget(summary);
    } catch (error) {
        renderWeatherWidget(cachedWeather || WEATHER_UNAVAILABLE);
    }
}

function escapeIcsText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function formatIcsDateTime(dateString, timeString) {
    if (!dateString) return '';
    const [year, month, day] = String(dateString).split('-').map(part => parseInt(part, 10));
    if (!year || !month || !day) return '';

    const dt = new Date(year, month - 1, day);
    if (!timeString) {
        return dt.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
    }

    const [hours, minutes] = String(timeString).split(':').map(part => parseInt(part, 10) || 0);
    dt.setHours(hours, minutes, 0, 0);
    return dt.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
}

function getEventEndDateTime(event) {
    const dateString = event.date || '';
    const startTime = event.start_time || '09:00';
    const endTime = event.end_time || '';

    if (endTime) {
        return formatIcsDateTime(dateString, endTime);
    }

    const [year, month, day] = String(dateString).split('-').map(part => parseInt(part, 10));
    if (!year || !month || !day) {
        return formatIcsDateTime(dateString, startTime);
    }

    const startDate = new Date(year, month - 1, day);
    const [hours, minutes] = String(startTime).split(':').map(part => parseInt(part, 10) || 0);
    startDate.setHours(hours, minutes, 0, 0);
    startDate.setHours(startDate.getHours() + 2);
    return startDate.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
}

function buildCalendarContent(events) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TDU PWA//EN',
        'CALSCALE:GREGORIAN'
    ];

    events.forEach((event, index) => {
        const summary = event.title || 'TDU Event';
        const description = event.description || '';
        const location = getCalendarLocation(event);
        const startDateTime = formatIcsDateTime(event.date, event.start_time || '09:00');
        const endDateTime = getEventEndDateTime(event);

        lines.push(
            'BEGIN:VEVENT',
            `UID:tdu-${event.id || index}-${Date.now()}@tdu-pwa`,
            `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z')}`,
            `SUMMARY:${escapeIcsText(summary)}`,
            `DESCRIPTION:${escapeIcsText(description)}`,
            `LOCATION:${escapeIcsText(location)}`,
            `DTSTART:${startDateTime}`,
            `DTEND:${endDateTime}`,
            'END:VEVENT'
        );
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

function getCalendarFileName(value) {
    const slug = String(value || 'tdu-event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${slug || 'tdu-event'}.ics`;
}

// Resolves true only once the calendar file has been handed to the browser (download started or share completed).
async function deliverCalendarFile(icsContent, fileName) {
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const supportsDownload = typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype;

    if (!supportsDownload && typeof File === 'function' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
        const file = new File([blob], fileName, { type: 'text/calendar' });
        if (navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'TDU 2027 calendar' });
                return true;
            } catch (error) {
                if (error && error.name === 'AbortError') return false;
            }
        }
    }

    if (!window.URL || typeof URL.createObjectURL !== 'function') return false;

    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
    } catch (error) {
        console.error('Calendar export failed:', error);
        return false;
    } finally {
        // Revoking immediately can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
}

async function exportEventsToCalendar(events, fileName) {
    if (!events.length) return false;

    let exported = false;
    try {
        exported = await deliverCalendarFile(buildCalendarContent(events), fileName);
    } catch (error) {
        console.error('Calendar export failed:', error);
    }

    if (!exported) return false;

    playAudioCue('export');
    if (window.TDUCelebrate) {
        window.TDUCelebrate.success({ confetti: true });
    }
    return true;
}

async function exportSavedEvents() {
    const savedEventIds = getSavedEvents();
    const selectedEvents = allEvents.filter((event) => savedEventIds.includes(String(event.id)));

    if (!selectedEvents.length) {
        alert('No saved events to export yet.');
        return false;
    }

    const exported = await exportEventsToCalendar(selectedEvents, 'my-tdu-itinerary.ics');
    if (exported) {
        trackAnalyticsEvent('export_calendar', {
            saved_event_count: selectedEvents.length
        });
    }
    return exported;
}

async function exportStageToCalendar(eventId) {
    const strId = String(eventId);
    const event = allEvents.find((item) => String(item.id) === strId);

    if (!event) {
        alert('This event could not be found. Please refresh and try again.');
        return false;
    }

    const exported = await exportEventsToCalendar([event], getCalendarFileName(event.title || event.id));
    if (exported) {
        trackAnalyticsEvent('export_stage_calendar', getEventAnalyticsPayload(strId));
    }
    return exported;
}

window.exportStageToCalendar = exportStageToCalendar;

async function fetchEvents() {
    try {
        const response = await fetch('./events.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Could not load events.json');
        allEvents = await response.json();
        updateSavedBadge();
        renderFeaturedEvents();
        renderRecommendationFlow();
        renderSchedule();
        handleEventDeepLink();
    } catch (error) {
        console.error('Fetch Error:', error);
        const container = document.getElementById('events-container');
        if (container) {
            container.innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${error.message}</p>`;
        }
        const featuredContainer = document.getElementById('featured-events');
        if (featuredContainer) {
            featuredContainer.innerHTML = "<div class='placeholder-card'>Featured events will appear here as more TDU events are announced.</div>";
        }
    }
}

// Notification taps open ./index.html?event=<id>; jump straight to that event card.
function handleEventDeepLink() {
    let params;
    try {
        params = new URLSearchParams(window.location.search);
    } catch (error) {
        return;
    }

    const eventId = params.get('event');
    if (!eventId) return;

    params.delete('event');
    const query = params.toString();
    if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }

    if (allEvents.some((event) => String(event.id) === eventId)) {
        window.openEventInSchedule(eventId, 'deep_link');
    }
}

function getFilteredScheduleEvents() {
    let displayEvents = allEvents.slice();

    if (currentDayFilter !== 'All') {
        displayEvents = displayEvents.filter((event) => event.date === currentDayFilter);
    }

    if (currentCatFilter !== 'All') {
        displayEvents = displayEvents.filter((event) => event.category && event.category.toLowerCase().includes(currentCatFilter.toLowerCase()));
    }

    return displayEvents;
}

function renderSchedule() {
    const container = document.getElementById('events-container');
    if (!container) return;
    container.innerHTML = '';

    const displayEvents = getFilteredScheduleEvents();

    if (displayEvents.length === 0) {
        container.innerHTML = "<p style='text-align:center; padding:30px; color:#666;'>No events found for this selection.</p>";
        return;
    }

    const savedEvents = getSavedEvents();

    displayEvents.forEach((event, index) => {
        const eventId = String(event.id || index + 1);
        const isSaved = savedEvents.includes(eventId);
        container.innerHTML += createEventCardHTML(event, eventId, isSaved);
    });

    if (window.TDUMotion) window.TDUMotion.revealCards(container);
}

function renderFeaturedEvents() {
    const container = document.getElementById('featured-events');
    if (!container) return;

    const featuredEvents = allEvents
        .filter((event) => event.featured === true)
        .sort((a, b) => {
            const priorityA = Number.isFinite(Number(a.featured_priority)) ? Number(a.featured_priority) : Number.MAX_SAFE_INTEGER;
            const priorityB = Number.isFinite(Number(b.featured_priority)) ? Number(b.featured_priority) : Number.MAX_SAFE_INTEGER;
            if (priorityA !== priorityB) return priorityA - priorityB;
            return String(a.date || '').localeCompare(String(b.date || ''));
        })
        .slice(0, 2);

    if (!featuredEvents.length) {
        container.innerHTML = "<div class='placeholder-card'>Featured events will appear here as more TDU events are announced.</div>";
        return;
    }

    container.innerHTML = featuredEvents.map((event, index) => {
        const eventId = String(event.id || index + 1);
        const type = getEventType(event);
        const rating = getEventRatingVibes(event);
        const sponsorName = getSponsorName(event);
        const isSponsored = getFeaturedReason(event) === 'sponsored';
        const metaParts = [
            formatDate(event.date),
            event.category || type,
            rating ? `TDU rating: ${rating}` : ''
        ].filter(Boolean);

        return `
            <article class="featured-card">
                ${isSponsored ? `<div class="event-badges"><span class="tag secondary-tag">Sponsored${sponsorName ? ` · ${escapeHTML(sponsorName)}` : ''}</span></div>` : ''}
                <div class="featured-meta">${metaParts.map((part) => `<span>${escapeHTML(part)}</span>`).join('')}</div>
                <h3>${escapeHTML(event.title || 'Featured event')}</h3>
                <button class="btn btn-primary featured-action" onclick="openEventInSchedule('${escapeHTML(eventId)}', 'featured')">View in schedule</button>
            </article>
        `;
    }).join('');
}

function isValidCheckpointCoords(coords) {
    if (typeof coords !== 'string') return false;
    const match = coords.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return false;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function minutesToTimeString(totalMinutes) {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function calculateEventEndTime(event) {
    const unknown = { time: '', minutes: null, isEstimated: false };
    if (!event || typeof event !== 'object') return unknown;

    const declaredEnd = timeToMinutes(event.end_time);
    if (declaredEnd !== null) {
        return { time: minutesToTimeString(declaredEnd), minutes: declaredEnd, isEstimated: false };
    }

    const start = timeToMinutes(event.start_time);
    if (start === null) return unknown;

    const distanceValue = Number(event.distance_km);
    const distance = Number.isFinite(distanceValue) && distanceValue > 0 ? distanceValue : DEFAULT_RIDE_DISTANCE_KM;
    const elevationValue = Number(event.elevation_m);
    const elevation = Number.isFinite(elevationValue) && elevationValue > 0 ? elevationValue : DEFAULT_RIDE_ELEVATION_M;

    const movingMinutes = (distance / RIDE_AVERAGE_SPEED_KMH) * 60;
    const climbingMinutes = (elevation / RIDE_ELEVATION_PER_HOUR_M) * 60;
    const endMinutes = Math.round(start + movingMinutes + climbingMinutes + RIDE_BUFFER_MINUTES);
    const time = minutesToTimeString(endMinutes);

    return { time, minutes: timeToMinutes(time), isEstimated: true };
}

function hasRideDistanceData(event) {
    if (!event || typeof event !== 'object') return false;
    const distance = Number(event.distance_km);
    return Number.isFinite(distance) && distance > 0;
}

function parseCoordinates(coords) {
    if (!coords) return null;

    let latitude = null;
    let longitude = null;

    if (typeof coords === 'string') {
        if (!isValidCheckpointCoords(coords)) return null;
        const parts = coords.trim().split(',');
        latitude = Number(parts[0]);
        longitude = Number(parts[1]);
    } else if (Array.isArray(coords) && coords.length >= 2) {
        latitude = Number(coords[0]);
        longitude = Number(coords[1]);
    } else if (typeof coords === 'object') {
        latitude = Number(coords.lat !== undefined ? coords.lat : coords.latitude);
        longitude = Number(coords.lng !== undefined ? coords.lng : (coords.lon !== undefined ? coords.lon : coords.longitude));
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

    return { lat: latitude, lng: longitude };
}

function getStageMapCheckpoints(event) {
    if (!event || !Array.isArray(event.checkpoints)) return [];

    return event.checkpoints
        .map((checkpoint) => {
            const coords = parseCoordinates(checkpoint && checkpoint.coords);
            if (!coords) return null;
            const passTimes = Array.isArray(checkpoint.pass_times) ? checkpoint.pass_times : [];
            const firstPass = passTimes
                .map((time) => timeToMinutes(time))
                .filter((minutes) => minutes !== null)
                .sort((a, b) => a - b)[0];
            return {
                name: String(checkpoint.name || 'Checkpoint'),
                description: String(checkpoint.description || ''),
                passTimes: passTimes.map(String),
                firstPass: firstPass === undefined ? Number.POSITIVE_INFINITY : firstPass,
                lat: coords.lat,
                lng: coords.lng
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.firstPass - b.firstPass);
}

function getEventCoords(event) {
    if (!event || typeof event !== 'object') return null;
    return parseCoordinates(event.coords || event.start_coords || event.location_coords);
}

function escapeXML(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildTransferGPX(originName, origin, destName, dest) {
    const trackName = `TDU Transfer: ${originName || 'Start'} to ${destName || 'Finish'}`;
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="TDU PWA" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
        '  <metadata>',
        `    <name>${escapeXML(trackName)}</name>`,
        '  </metadata>',
        `  <wpt lat="${origin.lat}" lon="${origin.lng}"><name>${escapeXML(originName || 'Start')}</name></wpt>`,
        `  <wpt lat="${dest.lat}" lon="${dest.lng}"><name>${escapeXML(destName || 'Finish')}</name></wpt>`,
        '  <trk>',
        `    <name>${escapeXML(trackName)}</name>`,
        '    <trkseg>',
        `      <trkpt lat="${origin.lat}" lon="${origin.lng}"></trkpt>`,
        `      <trkpt lat="${dest.lat}" lon="${dest.lng}"></trkpt>`,
        '    </trkseg>',
        '  </trk>',
        '</gpx>'
    ].join('\n');
}

function buildTransferFileName(destName) {
    const safeName = String(destName || 'Route')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '');
    return `TDU_Transfer_${safeName || 'Route'}.gpx`;
}

function buildBrouterUrl(origin, dest) {
    return `https://brouter.de/brouter-web/#map=${BROUTER_MAP_CENTRE}&lonlats=${origin.lng},${origin.lat}|${dest.lng},${dest.lat}&profile=trekking`;
}

function downloadTransferGPX(originName, originCoords, destName, destCoords) {
    const origin = parseCoordinates(originCoords);
    const dest = parseCoordinates(destCoords);

    if (!origin || !dest) {
        alert('Sorry, this transfer does not have valid coordinates for a GPX route yet.');
        return false;
    }

    const gpxContent = buildTransferGPX(originName, origin, destName, dest);
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildTransferFileName(destName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);

    trackAnalyticsEvent('download_transfer_gpx', {
        transfer_origin: String(originName || ''),
        transfer_destination: String(destName || '')
    });

    return true;
}

function isTransferEvent(event) {
    if (getEventType(event).toLowerCase() === 'race stage') return false;
    const eventKind = `${event.category || ''} ${event.type || ''}`.toLowerCase();
    return ['ride', 'social', 'pop-up', 'popup'].some(kind => eventKind.includes(kind));
}

function generateItineraryInsights(savedEvents) {
    const eventsByDate = savedEvents.reduce((groups, event) => {
        if (!event || typeof event.date !== 'string' || !event.date.trim()) return groups;
        const date = event.date.trim();
        if (!groups[date]) groups[date] = [];
        groups[date].push(event);
        return groups;
    }, {});
    const insights = [];

    Object.values(eventsByDate).forEach((events) => {
        const timedEvents = events
            .map((event) => {
                const endInfo = calculateEventEndTime(event);
                return {
                    event,
                    start: timeToMinutes(event.start_time),
                    end: endInfo.minutes,
                    endTime: endInfo.time,
                    isEstimatedEnd: endInfo.isEstimated
                };
            })
            .filter(item => item.start !== null && item.end !== null && item.end >= item.start)
            .sort((a, b) => a.start - b.start);

        timedEvents.forEach((current, index) => {
            timedEvents.slice(index + 1).forEach((next) => {
                const isRaceStage = item => getEventType(item.event).toLowerCase() === 'race stage';
                const isRide = item => !isRaceStage(item) && isRideEvent(item.event);
                const ride = isRide(current) && isRaceStage(next) ? current
                    : (isRide(next) && isRaceStage(current) ? next : null);
                const stage = ride === current ? next : current;
                if (ride && ride.start <= stage.start && stage.start < ride.end) {
                    const rideEndLabel = `~${formatTime(ride.endTime)}${ride.isEstimatedEnd ? ' (estimated)' : ''}`;
                    insights.push({
                        type: 'warning',
                        title: '⚠️ Schedule Conflict',
                        text: `⚡ Stage ${stage.event.title || 'race stage'} starts at ${formatTime(stage.event.start_time)} while your ride is still in progress (ends ${rideEndLabel}). Use the spectator transfer tip below to intercept the peloton on course!`
                    });
                    return;
                }

                const gap = next.start - current.end;
                if (gap >= 20) return;
                const endLabel = `${formatTime(current.endTime)}${current.isEstimatedEnd ? ' (estimated)' : ''}`;
                insights.push({
                    type: 'warning',
                    title: '⚠️ Schedule Conflict',
                    text: `${current.event.title || 'Earlier event'} ends at ${endLabel}, leaving under 20 mins before ${next.event.title || 'next event'} starts at ${formatTime(next.event.start_time)}.`
                });
            });
        });

        const stages = events.filter(event =>
            getEventType(event).toLowerCase() === 'race stage'
            && Array.isArray(event.checkpoints)
            && event.checkpoints.length
        );
        const morningEvents = events
            .map(event => ({ event, endInfo: calculateEventEndTime(event) }))
            .filter(({ event, endInfo }) =>
                isTransferEvent(event)
                && endInfo.minutes !== null
                && endInfo.minutes <= timeToMinutes('12:30')
                && String(event.location || '').trim()
            );

        morningEvents.forEach(({ event: morningEvent, endInfo }) => {
            const eventEnd = endInfo.minutes;
            stages.forEach((stage) => {
                const feasibleCheckpoints = stage.checkpoints
                    .filter((checkpoint) => {
                        const deadline = timeToMinutes(checkpoint && checkpoint.arrival_deadline);
                        const passTimes = checkpoint && Array.isArray(checkpoint.pass_times)
                            ? checkpoint.pass_times.filter(time => timeToMinutes(time) !== null)
                            : [];
                        return checkpoint
                            && String(checkpoint.name || '').trim()
                            && isValidCheckpointCoords(checkpoint.coords)
                            && deadline !== null
                            && deadline >= eventEnd + 45
                            && passTimes.length;
                    })
                    .map(checkpoint => ({
                        ...checkpoint,
                        validPassTimes: checkpoint.pass_times
                            .filter(time => timeToMinutes(time) !== null)
                            .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
                    }))
                    .sort((a, b) =>
                        b.validPassTimes.length - a.validPassTimes.length
                        || timeToMinutes(a.arrival_deadline) - timeToMinutes(b.arrival_deadline)
                    );

                const checkpoint = feasibleCheckpoints[0];
                if (!checkpoint) return;

                const originName = String(morningEvent.location).trim();
                const originCoords = getEventCoords(morningEvent);
                const destCoords = parseCoordinates(checkpoint.coords);
                const finishLabel = `${formatTime(endInfo.time)}${endInfo.isEstimated ? ' (estimated finish)' : ''}`;
                const route = originCoords && destCoords
                    ? {
                        originName,
                        originCoords: `${originCoords.lat},${originCoords.lng}`,
                        destName: String(checkpoint.name).trim(),
                        destCoords: `${destCoords.lat},${destCoords.lng}`,
                        brouterUrl: buildBrouterUrl(originCoords, destCoords)
                    }
                    : null;

                insights.push({
                    type: 'suggestion',
                    title: '💡 Smart Spectator Transfer Tip',
                    text: `After ${morningEvent.title || 'your morning event'} finishes at ${finishLabel}, cycle to ${checkpoint.name}. The peloton passes from ${formatTimeRange(checkpoint.validPassTimes[0], checkpoint.validPassTimes[checkpoint.validPassTimes.length - 1])}!`,
                    note: route
                        ? 'Allow at least 45 minutes to transfer. Download the GPX for your head unit, or open the route in BRouter to fine-tune it.'
                        : 'Allow at least 45 minutes to transfer. This conservative buffer assumes a 20–25 km/h cycling pace because the event data has no origin coordinates.',
                    route
                });
            });
        });
    });

    renderItineraryInsights(insights);
}

function renderInsightRouteActions(route) {
    if (!route) return '';
    return `
            <div class="insight-actions">
                <button
                    type="button"
                    class="btn-gpx"
                    data-origin-name="${escapeHTML(route.originName)}"
                    data-origin-coords="${escapeHTML(route.originCoords)}"
                    data-dest-name="${escapeHTML(route.destName)}"
                    data-dest-coords="${escapeHTML(route.destCoords)}"
                    onclick="downloadTransferGPX(this.dataset.originName, this.dataset.originCoords, this.dataset.destName, this.dataset.destCoords)"
                >📥 Download GPX</button>
                <a class="btn-brouter" href="${escapeHTML(route.brouterUrl)}" target="_blank" rel="noopener noreferrer">🚴 Open in BRouter</a>
            </div>`;
}

function renderItineraryInsights(insights) {
    const list = document.getElementById('drawer-insights-list');
    const bar = document.getElementById('smart-assistant-bar');
    const summary = document.getElementById('assistant-summary-text');

    if (list) {
        list.innerHTML = insights.map((insight) => `
        <article class="insight-card ${insight.type}" ${insight.type === 'warning' ? 'role="alert"' : 'role="status"'}>
            <h4>${escapeHTML(insight.title)}</h4>
            <p>${escapeHTML(insight.text)}</p>
            ${insight.note ? `<p class="insight-note">${escapeHTML(insight.note)}</p>` : ''}
            ${renderInsightRouteActions(insight.route)}
        </article>
    `).join('');
    }

    if (summary) {
        const warnings = insights.filter(insight => insight.type === 'warning').length;
        const suggestions = insights.length - warnings;
        const parts = [];
        if (warnings) parts.push(`${warnings} schedule ${warnings === 1 ? 'conflict' : 'conflicts'}`);
        if (suggestions) parts.push(`${suggestions} transfer ${suggestions === 1 ? 'tip' : 'tips'}`);
        summary.textContent = parts.length ? `⚡ ${parts.join(' • ')}` : '⚡ Insights available';
    }

    if (bar) {
        bar.classList.toggle('hidden', insights.length === 0);
    }

    if (!insights.length) {
        toggleAssistantDrawer(false);
    }
}

function toggleAssistantDrawer(show) {
    const overlay = document.getElementById('assistant-drawer-overlay');
    if (!overlay) return;

    const shouldOpen = show === true;
    const wasOpen = overlay.classList.contains('open');
    overlay.classList.toggle('open', shouldOpen);
    overlay.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');

    if (shouldOpen) {
        const closeButton = overlay.querySelector('.close-btn');
        if (closeButton) closeButton.focus();
    } else if (wasOpen) {
        const bar = document.getElementById('smart-assistant-bar');
        if (bar && !bar.classList.contains('hidden')) bar.focus();
    }
}

function handleAssistantBarKeydown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleAssistantDrawer(true);
}

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const overlay = document.getElementById('assistant-drawer-overlay');
    if (overlay && overlay.classList.contains('open')) toggleAssistantDrawer(false);
});

function renderSaved() {
    const container = document.getElementById('saved-events-container');
    if (!container) return;
    container.innerHTML = '';

    const savedEvents = getSavedEvents();
    const displayEvents = allEvents.filter(e => savedEvents.includes(String(e.id)));
    generateItineraryInsights(displayEvents);

    if (displayEvents.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#666; background:white; border-radius:16px; border:1px solid #e0e0e0;">
                <i class="far fa-heart" style="font-size:2.5rem; color:#ccc; margin-bottom:10px; display:block;"></i>
                <p style="margin:0 0 10px 0; font-weight:700;">Your itinerary is empty</p>
                <p style="margin:0; font-size:0.85rem; color:#888;">Tap the heart icon on any event in the Schedule to save it to My TDU.</p>
            </div>
        `;
        return;
    }

    displayEvents.forEach((event, index) => {
        const eventId = String(event.id || index + 1);
        container.innerHTML += createEventCardHTML(event, eventId, true);
    });
}

function createChoiceButtons(buttons, selectedValue, onClickName) {
    return buttons.map((button) => `
        <button
            type="button"
            class="choice-btn ${selectedValue === button.id ? 'active' : ''}"
            aria-pressed="${selectedValue === button.id ? 'true' : 'false'}"
            onclick="${onClickName}('${button.id}')"
        >
            ${escapeHTML(button.label)}
        </button>
    `).join('');
}

function renderRecommendationFlow() {
    const launchBtn = document.getElementById('recommendation-launch-btn');
    const flow = document.getElementById('recommendation-flow');
    const intentButtons = document.getElementById('recommendation-intent-buttons');
    const stepTwo = document.getElementById('recommendation-step-two');
    const optionButtons = document.getElementById('recommendation-option-buttons');
    const backBtn = document.getElementById('recommendation-back-btn');
    const results = document.getElementById('recommendation-results');

    if (!launchBtn || !flow || !intentButtons || !stepTwo || !optionButtons || !backBtn || !results) return;

    launchBtn.setAttribute('aria-expanded', recommendationState.isOpen ? 'true' : 'false');
    flow.hidden = !recommendationState.isOpen;
    intentButtons.innerHTML = createChoiceButtons(INTENT_BUTTONS, recommendationState.intent, 'selectRecommendationIntent');

    const options = RECOMMENDATION_OPTIONS[recommendationState.intent] || [];
    stepTwo.hidden = !recommendationState.intent;
    optionButtons.innerHTML = recommendationState.intent
        ? createChoiceButtons(options, recommendationState.option, 'selectRecommendationOption')
        : '';

    backBtn.hidden = !recommendationState.intent;

    if (!recommendationState.isOpen) {
        results.innerHTML = '';
        return;
    }

    if (!recommendationState.intent) {
        results.innerHTML = "<p class='helper-copy'>Start with one of the three intent buttons above.</p>";
        return;
    }

    if (!recommendationState.option) {
        const intentCopy = recommendationState.intent === 'ride'
            ? 'We will only suggest participatory ride events here.'
            : recommendationState.intent === 'watch'
                ? 'We will only suggest race stages here.'
                : 'We will only suggest social, family, food, or featured community events here.';
        results.innerHTML = `<p class='helper-copy'>${intentCopy}</p>`;
        return;
    }

    const result = getRecommendationResult(recommendationState.intent, recommendationState.option);

    if (!result.matches.length) {
        results.innerHTML = `<div class="placeholder-card">${escapeHTML(result.emptyMessage)}</div>`;
        return;
    }

    results.innerHTML = `
        <div class="helper-copy">${escapeHTML(result.summary)}</div>
        <div class="recommendation-list">
            ${result.matches.map(({ event, reason }, index) => {
                const rating = getEventRatingVibes(event);
                const meta = [event.category || getEventType(event), formatDate(event.date), rating ? `TDU rating: ${rating}` : ''].filter(Boolean).join(' • ');
                const eventId = String(event.id || index + 1);
                return `
                    <article class="recommendation-card">
                        <div class="recommendation-meta">${escapeHTML(meta)}</div>
                        <h3>${escapeHTML(event.title || 'Recommended event')}</h3>
                        <p>${escapeHTML(reason)}</p>
                        <button class="btn btn-primary recommendation-action" onclick="openEventInSchedule('${escapeHTML(eventId)}', 'recommendation')">View in schedule</button>
                    </article>
                `;
            }).join('')}
        </div>
    `;

    trackAnalyticsEvent('open_recommendation_result', {
        recommendation_intent: recommendationState.intent,
        recommendation_option: recommendationState.option,
        result_count: result.matches.length,
        top_result_id: result.matches[0] ? String(result.matches[0].event.id || '') : ''
    });
}

function matchRecommendationOption(event, intent, optionId) {
    const tags = getEventTags(event);

    if (intent === 'ride') {
        if (!isRideEvent(event)) return false;
        if (optionId === 'hills') return tags.includes('hills') || tags.includes('climbing');
        if (optionId === 'gravel') return tags.includes('gravel');
        if (optionId === 'easy-social') return tags.includes('social') || tags.includes('coffee') || tags.includes('family');
        if (optionId === 'fast-flat') return tags.includes('fast') || tags.includes('flat') || tags.includes('road');
        return false;
    }

    if (intent === 'watch') {
        if (!isWatchEvent(event)) return false;
        if (optionId === 'climbing') return tags.includes('climbing') || tags.includes('hills');
        if (optionId === 'coastal') return tags.includes('coastal');
        if (optionId === 'city') return tags.includes('city');
        if (optionId === 'any-stage') return true;
        return false;
    }

    if (!isSocialEvent(event)) return false;
    if (optionId === 'coffee') return tags.includes('coffee');
    if (optionId === 'beer-atmosphere') return tags.includes('beer') || tags.includes('food') || tags.includes('drink');
    if (optionId === 'family-friendly') return tags.includes('family');
    if (optionId === 'featured') return tags.includes('featured');
    return false;
}

function getRecommendationSummary(intent, optionId, count) {
    if (intent === 'ride') {
        return `${count} ride option${count > 1 ? 's' : ''} matched for ${formatOptionLabel(optionId)}.`;
    }
    if (intent === 'watch') {
        return `${count} race stage${count > 1 ? 's' : ''} matched for ${formatOptionLabel(optionId)}.`;
    }
    return `${count} social option${count > 1 ? 's' : ''} matched for ${formatOptionLabel(optionId)}.`;
}

function getRecommendationEmptyMessage(intent) {
    if (intent === 'ride') {
        return 'No ride matches yet. This guide only recommends participatory rides for ride picks, and the current dataset is race-stage-only. Group rides, gravel options, and social spins will appear here as they are added.';
    }
    if (intent === 'social') {
        return 'No social matches yet. We are not forcing race stages into social picks — coffee rides, pop-ups, family events, and featured community events will appear here as they are added.';
    }
    return 'No matching race stages were found for that choice just now.';
}

function buildRecommendationReason(event, intent, optionId) {
    const rating = getEventRatingVibes(event);
    const area = getEventArea(event.finish_location || event.location);

    if (intent === 'watch') {
        if (optionId === 'climbing') {
            return `Watch the race in ${area || 'the Adelaide Hills'} for a climbing-heavy stage${rating ? ` with ${rating}.` : '.'}`;
        }
        if (optionId === 'coastal') {
            return `Watch the race in ${area || 'a coastal setting'} for a seaside stage day${rating ? ` with ${rating}.` : '.'}`;
        }
        if (optionId === 'city') {
            return `Watch the race in ${area || 'a city setting'} for an accessible city-based stage option${rating ? ` with ${rating}.` : '.'}`;
        }
        return `Watch the race in ${area || 'South Australia'} on ${formatDate(event.date)}${rating ? ` with ${rating}.` : '.'}`;
    }

    if (intent === 'ride') {
        return `This ${String(getEventType(event) || event.category || 'ride event').toLowerCase()} matched your ${formatOptionLabel(optionId)} ride preference${rating ? ` and carries ${rating}.` : '.'}`;
    }

    return `This ${String(getEventType(event) || event.category || 'social event').toLowerCase()} matched your ${formatOptionLabel(optionId)} social pick${rating ? ` and carries ${rating}.` : '.'}`;
}

function getRecommendationResult(intent, optionId) {
    const eligibleEvents = allEvents
        .filter((event) => getEventStatus(event) !== 'cancelled')
        .filter((event) => {
            if (intent === 'ride') return isRideEvent(event);
            if (intent === 'watch') return isWatchEvent(event);
            return isSocialEvent(event);
        });

    const matches = eligibleEvents
        .filter((event) => matchRecommendationOption(event, intent, optionId))
        .sort((a, b) => {
            if (a.featured !== b.featured) return a.featured ? -1 : 1;
            return String(a.date || '').localeCompare(String(b.date || ''));
        })
        .slice(0, 3)
        .map((event) => ({
            event,
            reason: buildRecommendationReason(event, intent, optionId)
        }));

    return {
        summary: getRecommendationSummary(intent, optionId, matches.length),
        matches,
        emptyMessage: getRecommendationEmptyMessage(intent)
    };
}

function resetScheduleFilters() {
    currentDayFilter = 'All';
    currentCatFilter = 'All';

    document.querySelectorAll('#day-filters .filter-btn').forEach((button) => {
        button.classList.toggle('active', button.textContent.trim() === 'All Days');
    });
    document.querySelectorAll('#category-filters .filter-btn').forEach((button) => {
        button.classList.toggle('active', button.textContent.trim() === 'All Stages');
    });
}

window.openEventInSchedule = function(eventId, source = 'schedule') {
    trackAnalyticsEvent('view_in_schedule_click', {
        source,
        ...getEventAnalyticsPayload(eventId)
    });
    resetScheduleFilters();
    showView('schedule');
    setFilterType('day');
    renderSchedule();

    window.requestAnimationFrame(() => {
        const target = document.getElementById(`event-${eventId}`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
};

function createEventCardHTML(event, eventId, isSaved) {
    const title = event.title || 'Untitled Event';
    const category = event.category || '';
    const dateDisplay = formatDate(event.date);
    const startTime = event.start_time || '';
    const endTime = event.end_time || '';
    const description = event.description || '';
    const routeUrl = event.route_url || '';
    const heartClass = isSaved ? 'fas saved' : 'far';
    const weatherText = event.weather || 'TBC';
    const rating = getEventRatingVibes(event);
    const { start, finish, hasDistinctFinish } = getEventLocations(event);
    const primaryLocation = start || finish;
    const primaryMapLink = primaryLocation ? `https://maps.google.com/?q=${encodeURIComponent(primaryLocation)}` : '#';
    const finishMapLink = hasDistinctFinish ? `https://maps.google.com/?q=${encodeURIComponent(finish)}` : primaryMapLink;
    const locationMeta = hasDistinctFinish
        ? `
            <span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> Start: ${escapeHTML(start)}</span>
            <span><i class="fas fa-flag-checkered" aria-hidden="true"></i> Finish: ${escapeHTML(finish)}</span>
        `
        : primaryLocation
            ? `<span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${escapeHTML(primaryLocation)}</span>`
            : '';

    let timeRange = startTime;
    if (startTime && endTime) {
        timeRange += ' - ' + endTime;
    } else if (startTime && hasRideDistanceData(event)) {
        const estimatedEnd = calculateEventEndTime(event);
        if (estimatedEnd.isEstimated && estimatedEnd.time) {
            timeRange += ' - ' + estimatedEnd.time + ' (est.)';
        }
    }

    return `
        <div class="event-card" id="event-${eventId}">
            <button class="fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave('${eventId}', this)" aria-label="Save event">
                <i class="${heartClass} fa-heart" aria-hidden="true"></i>
            </button>

            <div class="event-badges">
                ${category ? `<span class="tag">${category}</span>` : ''}
                ${rating ? `<span class="tag secondary-tag">${rating}</span>` : ''}
            </div>
            <h3>${escapeHTML(title)}</h3>

            <div class="event-meta">
                ${dateDisplay || timeRange ? `<span><i class="far fa-calendar" aria-hidden="true"></i> ${dateDisplay} ${dateDisplay && timeRange ? ' • ' : ''} ${timeRange}</span>` : ''}
                ${locationMeta}
                <span class="event-weather"><i class="fas fa-cloud-sun" aria-hidden="true"></i> Weather: ${weatherText}</span>
            </div>

            ${description ? `<div class="event-desc">${description}</div>` : ''}

            <div class="card-actions">
                ${primaryLocation ? `<a href="${primaryMapLink}" target="_blank" rel="noopener" class="btn" onclick="trackEventAction('open_start_map', '${escapeHTML(eventId)}')"><i class="fas fa-directions" aria-hidden="true"></i> ${hasDistinctFinish ? 'Start map' : 'Navigate'}</a>` : ''}
                ${hasDistinctFinish ? `<a href="${finishMapLink}" target="_blank" rel="noopener" class="btn" onclick="trackEventAction('open_finish_map', '${escapeHTML(eventId)}')"><i class="fas fa-flag-checkered" aria-hidden="true"></i> Finish map</a>` : ''}
                ${routeUrl ? `<a href="${routeUrl}" target="_blank" rel="noopener" class="btn btn-primary" onclick="trackEventAction('open_route_link', '${escapeHTML(eventId)}')"><i class="fas fa-route" aria-hidden="true"></i> Route</a>` : ''}
                ${getStageMapCheckpoints(event).length ? `<button type="button" class="btn" onclick="openStageMap('${escapeHTML(eventId)}')"><i class="fas fa-map-marked-alt" aria-hidden="true"></i> Stage map</button>` : ''}
                <button type="button" class="btn" onclick="exportStageToCalendar('${escapeHTML(eventId)}')"><i class="far fa-calendar-plus" aria-hidden="true"></i> Add to calendar</button>
            </div>
        </div>
    `;
}

window.toggleSave = function(id, btnElement) {
    let savedEvents = getSavedEvents();
    const strId = String(id);

    if (savedEvents.includes(strId)) {
        savedEvents = savedEvents.filter(eventId => eventId !== strId);
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '<i class="far fa-heart" aria-hidden="true"></i>';
        }
        playAudioCue('unsave');
        trackAnalyticsEvent('remove_saved_event', getEventAnalyticsPayload(strId));
    } else {
        savedEvents.push(strId);
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '<i class="fas fa-heart" aria-hidden="true"></i>';
        }
        playAudioCue('save');
        trackAnalyticsEvent('save_event', getEventAnalyticsPayload(strId));
    }

    localStorage.setItem('savedTDU', JSON.stringify(savedEvents));
    updateSavedBadge();

    const activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-saved') {
        renderSaved();
    }
};

window.openRecommendationFlow = function() {
    recommendationState.isOpen = true;
    renderRecommendationFlow();
    trackAnalyticsEvent('open_recommendation_flow');
};

window.selectRecommendationIntent = function(intent) {
    recommendationState.isOpen = true;
    recommendationState.intent = intent;
    recommendationState.option = '';
    renderRecommendationFlow();
    trackAnalyticsEvent('select_recommendation_intent', {
        recommendation_intent: intent
    });
};

window.selectRecommendationOption = function(optionId) {
    recommendationState.option = optionId;
    renderRecommendationFlow();
    trackAnalyticsEvent('select_recommendation_option', {
        recommendation_intent: recommendationState.intent,
        recommendation_option: optionId
    });
};

window.goBackRecommendation = function() {
    recommendationState.option = '';
    recommendationState.intent = '';
    renderRecommendationFlow();
};

window.resetRecommendationFlow = function() {
    recommendationState.isOpen = false;
    recommendationState.intent = '';
    recommendationState.option = '';
    renderRecommendationFlow();
};

function updateSavedBadge() {
    const savedEvents = getSavedEvents();
    const badge = document.getElementById('nav-badge');
    const homeCount = document.getElementById('home-saved-count');

    if (savedEvents.length > 0) {
        if (badge) {
            badge.innerText = savedEvents.length;
            badge.style.display = 'block';
        }
        if (homeCount) homeCount.innerText = savedEvents.length + ' event' + (savedEvents.length > 1 ? 's' : '') + ' saved';
    } else {
        if (badge) badge.style.display = 'none';
        if (homeCount) homeCount.innerText = '0 events saved';
    }
}

window.showView = function(viewName) {
    const viewEl = document.getElementById('view-' + viewName);
    const navEl = document.getElementById('nav-' + viewName);
    if (!viewEl || !navEl) return;

    const isSameView = currentViewName === viewName && viewEl.classList.contains('active') && navEl.classList.contains('active');
    const shouldTrackView = !isSameView || !hasTrackedInitialView;

    if (!isSameView) {
        if (window.TDUHaptics) window.TDUHaptics.navigation();
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        viewEl.classList.add('active');
        navEl.classList.add('active');
        currentViewName = viewName;
    }

    if (viewName === 'schedule') {
        renderSchedule();
    } else if (viewName === 'saved') {
        renderSaved();
    }

    if (shouldTrackView) {
        trackVirtualPageView(viewName);
        hasTrackedInitialView = true;
    }

    window.scrollTo(0, 0);
};

window.setFilterType = function(type) {
    const dayFilters = document.getElementById('day-filters');
    const catFilters = document.getElementById('category-filters');
    const label = document.getElementById('filter-label-text');

    if (!dayFilters || !catFilters || !label) return;

    if (type === 'day') {
        dayFilters.style.display = 'flex';
        catFilters.style.display = 'none';
        label.innerText = 'Filter by Date';
    } else {
        dayFilters.style.display = 'none';
        catFilters.style.display = 'flex';
        label.innerText = 'Filter by Category';
    }
};

window.applyDayFilter = function(day, btn) {
    if (btn && day !== currentDayFilter && window.TDUHaptics) window.TDUHaptics.navigation();
    currentDayFilter = day;
    document.querySelectorAll('#day-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSchedule();
};

window.applyCategoryFilter = function(category, btn) {
    if (btn && category !== currentCatFilter && window.TDUHaptics) window.TDUHaptics.navigation();
    currentCatFilter = category;
    document.querySelectorAll('#category-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSchedule();
};

window.trackEventAction = function(action, eventId) {
    trackAnalyticsEvent(action, getEventAnalyticsPayload(eventId));
    return true;
};

function checkPWAStatus() {
    const btn = document.getElementById('header-install-btn');
    if (!btn) return;

    if (isStandaloneMode()) {
        btn.style.display = 'none';
    } else if (isIOS) {
        btn.style.display = 'flex';
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('header-install-btn');
    if (btn && !isStandaloneMode()) {
        btn.style.display = 'flex';
    }
});

window.openFeedbackModal = function() {
    const modal = document.getElementById('feedback-modal');
    const frame = document.getElementById('feedback-form-frame');

    if (frame) {
        const formSrc = String(frame.dataset.formSrc || '').trim();
        const hasConfiguredForm = formSrc && !formSrc.includes('REPLACE_WITH_REAL_FORM_ID');
        if (hasConfiguredForm) {
            if (frame.hasAttribute('srcdoc')) {
                frame.removeAttribute('srcdoc');
            }
            if (frame.src !== formSrc) {
                frame.src = formSrc;
            }
        }
    }

    if (modal) {
        trackAnalyticsEvent('open_feedback_modal');
        modal.classList.add('active');
        const closeButton = modal.querySelector('.close-btn');
        if (closeButton) closeButton.focus();
    }
};

window.closeFeedbackModal = function(e) {
    if (!e || e.target.classList.contains('modal-overlay') || e.target.classList.contains('close-btn')) {
        const modal = document.getElementById('feedback-modal');
        if (modal) modal.classList.remove('active');
    }
};

window.openFeedbackForm = function() {
    const frame = document.getElementById('feedback-form-frame');
    const shareUrl = String(frame && frame.dataset ? frame.dataset.formShareUrl || '' : '').trim();

    if (!shareUrl || !isAllowedFeedbackUrl(shareUrl)) return false;

    trackAnalyticsEvent('click_feedback_form_link');
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
    return false;
};

window.openSupportModal = function() {
    trackAnalyticsEvent('click_support_coming_soon');
    const modal = document.getElementById('support-modal');
    if (modal) {
        modal.classList.add('active');
        const closeButton = modal.querySelector('.close-btn');
        if (closeButton) closeButton.focus();
    }
};

window.closeSupportModal = function(e) {
    if (!e || e.target.classList.contains('modal-overlay') || e.target.classList.contains('close-btn')) {
        const modal = document.getElementById('support-modal');
        if (modal) modal.classList.remove('active');
    }
};

window.triggerInstall = function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((result) => {
            if (result.outcome === 'accepted') {
                const btn = document.getElementById('header-install-btn');
                if (btn) btn.style.display = 'none';
                trackAnalyticsEvent('app_install_accepted');
            }
            deferredPrompt = null;
        });
    } else {
        const modal = document.getElementById('install-modal');
        if (modal) modal.classList.add('active');
    }
};

window.closeInstallModal = function(e) {
    if (!e || e.target.classList.contains('modal-overlay') || e.target.classList.contains('close-btn') || e.target.tagName === 'BUTTON') {
        const modal = document.getElementById('install-modal');
        if (modal) modal.classList.remove('active');
    }
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js');
    });
}

function trackStandaloneLaunchIfNeeded() {
    const alreadyTracked = sessionStorage.getItem(STANDALONE_LAUNCH_SESSION_KEY) === 'true';
    if (isStandaloneMode() && !alreadyTracked) {
        trackAnalyticsEvent('standalone_launch');
        sessionStorage.setItem(STANDALONE_LAUNCH_SESSION_KEY, 'true');
    }
}

if (document.readyState === 'complete') {
    trackStandaloneLaunchIfNeeded();
} else {
    window.addEventListener('load', trackStandaloneLaunchIfNeeded, { once: true });
}

checkPWAStatus();
updateSoundButtonUI(isAudioFeedbackEnabled());
updateWeatherWidget();
renderRecommendationFlow();
showView(currentViewName);
fetchEvents();
