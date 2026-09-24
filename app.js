let allEvents = [];
let currentDayFilter = 'All';
let currentCatFilter = 'All';
let currentSearchTerm = '';
let deferredPrompt = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ADL_WEATHER_PLACEHOLDER = 'Today in Adelaide: 24°C • Partly cloudy';
const CATEGORY_ORDER = [
    { key: `type:Men's Stage`, kind: 'type', value: `Men's Stage`, label: `Men's Stage` },
    { key: `type:Women's Stage`, kind: 'type', value: `Women's Stage`, label: `Women's Stage` },
    { key: 'category:Race Stage', kind: 'category', value: 'Race Stage', label: 'Race Stage' },
    { key: 'category:Group Ride', kind: 'category', value: 'Group Ride', label: 'Group Ride' },
    { key: 'category:Social', kind: 'category', value: 'Social', label: 'Social' }
];

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

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSafeUrl(value) {
    if (!value) return '';

    try {
        const url = new URL(value, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
        return '';
    }
}

function getSavedEvents() {
    try {
        return JSON.parse(localStorage.getItem('savedTDU') || '[]');
    } catch (error) {
        return [];
    }
}

function updateWeatherWidget() {
    const widget = document.getElementById('weather-widget');
    if (!widget) return;

    widget.innerHTML = `
        <i class="fas fa-cloud-sun" aria-hidden="true"></i>
        <span>${ADL_WEATHER_PLACEHOLDER}</span>
    `;
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
    const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
    if (!year || !month || !day) return '';

    const dt = new Date(year, month - 1, day);
    if (!timeString) {
        return dt.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
    }

    const [hours, minutes] = String(timeString).split(':').map((part) => parseInt(part, 10) || 0);
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

    const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
    if (!year || !month || !day) {
        return formatIcsDateTime(dateString, startTime);
    }

    const startDate = new Date(year, month - 1, day);
    const [hours, minutes] = String(startTime).split(':').map((part) => parseInt(part, 10) || 0);
    startDate.setHours(hours, minutes, 0, 0);
    startDate.setHours(startDate.getHours() + 2);
    return startDate.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
}

function normalizeEvent(event, index) {
    const normalizedTags = Array.isArray(event.tags)
        ? event.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [];

    const normalizedEvent = {
        ...event,
        id: String(event.id || index + 1),
        title: String(event.title || 'Untitled Event'),
        description: String(event.description || ''),
        category: String(event.category || ''),
        type: String(event.type || event.category || ''),
        location: String(event.location || ''),
        date: String(event.date || ''),
        start_time: String(event.start_time || ''),
        end_time: String(event.end_time || ''),
        route_url: getSafeUrl(event.route_url),
        details_url: getSafeUrl(event.details_url),
        source_url: getSafeUrl(event.source_url || event.details_url),
        tags: normalizedTags,
        featured: Boolean(event.featured),
        status: String(event.status || ''),
        weather: String(event.weather || ''),
        tdu_rating: String(event.tdu_rating || ''),
        tdu_rating_reason: String(event.tdu_rating_reason || '')
    };

    const distance = typeof event.distance_km === 'number' ? event.distance_km : parseFloat(event.distance_km);
    normalizedEvent.distance_km = Number.isFinite(distance) ? distance : null;
    normalizedEvent.search_blob = [
        normalizedEvent.title,
        normalizedEvent.description,
        normalizedEvent.location,
        normalizedEvent.category,
        normalizedEvent.type,
        normalizedEvent.tags.join(' ')
    ].join(' ').toLowerCase();

    return normalizedEvent;
}

function sortEvents(events) {
    return [...events].sort((a, b) => {
        const left = `${a.date || ''}T${a.start_time || '00:00'}`;
        const right = `${b.date || ''}T${b.start_time || '00:00'}`;
        return left.localeCompare(right);
    });
}

function getCategoryFilterDefinitions(events) {
    const eventTypes = new Set(events.map((event) => event.type).filter(Boolean));
    const eventCategories = new Set(events.map((event) => event.category).filter(Boolean));
    const definitions = [{ key: 'All', label: 'All Events', predicate: () => true }];
    const usedKeys = new Set(['All']);

    CATEGORY_ORDER.forEach((definition) => {
        const isPresent = definition.kind === 'type'
            ? eventTypes.has(definition.value)
            : eventCategories.has(definition.value);

        if (!isPresent) return;
        usedKeys.add(definition.key);
        definitions.push({
            key: definition.key,
            label: definition.label,
            predicate: (event) => (definition.kind === 'type' ? event.type : event.category) === definition.value
        });
    });

    if (events.some((event) => event.featured)) {
        definitions.push({
            key: 'featured',
            label: 'Featured',
            predicate: (event) => event.featured
        });
        usedKeys.add('featured');
    }

    const extras = [];

    [...eventTypes].sort().forEach((value) => {
        const key = `type:${value}`;
        if (usedKeys.has(key)) return;
        extras.push({ key, label: value, predicate: (event) => event.type === value });
    });

    [...eventCategories].sort().forEach((value) => {
        const key = `category:${value}`;
        if (usedKeys.has(key)) return;
        extras.push({ key, label: value, predicate: (event) => event.category === value });
    });

    return definitions.concat(extras);
}

function getCurrentCategoryDefinition() {
    return getCategoryFilterDefinitions(allEvents).find((definition) => definition.key === currentCatFilter)
        || { key: 'All', label: 'All Events', predicate: () => true };
}

function getFilteredEvents() {
    const categoryDefinition = getCurrentCategoryDefinition();
    const normalizedSearch = currentSearchTerm.trim().toLowerCase();

    return allEvents.filter((event) => {
        if (currentDayFilter !== 'All' && event.date !== currentDayFilter) {
            return false;
        }

        if (categoryDefinition.key !== 'All' && !categoryDefinition.predicate(event)) {
            return false;
        }

        if (normalizedSearch && !event.search_blob.includes(normalizedSearch)) {
            return false;
        }

        return true;
    });
}

function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    const definitions = getCategoryFilterDefinitions(allEvents);
    if (!definitions.some((definition) => definition.key === currentCatFilter)) {
        currentCatFilter = 'All';
    }

    container.innerHTML = '';
    definitions.forEach((definition) => {
        const button = document.createElement('button');
        button.className = `filter-btn${definition.key === currentCatFilter ? ' active' : ''}`;
        button.type = 'button';
        button.textContent = definition.label;
        button.addEventListener('click', () => applyCategoryFilter(definition.key, button));
        container.appendChild(button);
    });
}

function setSearchInputValue(value) {
    const input = document.getElementById('schedule-search');
    if (input && input.value !== value) {
        input.value = value;
    }
}

function createEmptyStateHTML() {
    const filters = [];
    const categoryDefinition = getCurrentCategoryDefinition();

    if (currentDayFilter !== 'All') {
        filters.push(`day ${escapeHtml(formatDate(currentDayFilter))}`);
    }

    if (categoryDefinition.key !== 'All') {
        filters.push(categoryDefinition.label.toLowerCase());
    }

    if (currentSearchTerm.trim()) {
        filters.push(`search “${escapeHtml(currentSearchTerm.trim())}”`);
    }

    const summary = filters.length
        ? `Try adjusting ${filters.join(', ')}.`
        : 'Try another search or filter combination.';

    return `
        <div class="empty-state">
            <i class="fas fa-search-minus" aria-hidden="true"></i>
            <p><strong>No events match right now.</strong><br>${summary}</p>
        </div>
    `;
}

function createTagChips(event) {
    const tags = [];

    if (event.type) {
        tags.push(`<span class="tag">${escapeHtml(event.type)}</span>`);
    }

    if (event.category && event.category !== event.type) {
        tags.push(`<span class="tag tag-muted">${escapeHtml(event.category)}</span>`);
    }

    if (event.featured) {
        tags.push('<span class="tag tag-featured">Featured</span>');
    }

    return tags.length ? `<div class="tag-row">${tags.join('')}</div>` : '';
}

function createHighlightChips(event) {
    const highlights = [];

    if (event.distance_km !== null) {
        highlights.push(`<span class="tag tag-muted">${escapeHtml(event.distance_km.toFixed(1))} km</span>`);
    }

    if (event.tdu_rating) {
        highlights.push(`<span class="tag tag-muted">${escapeHtml(event.tdu_rating)}</span>`);
    }

    event.tags.slice(0, 4).forEach((tag) => {
        highlights.push(`<span class="tag tag-muted">${escapeHtml(tag)}</span>`);
    });

    return highlights.length ? `<div class="event-highlights">${highlights.join('')}</div>` : '';
}

function createEventCardHTML(event, eventId, isSaved) {
    const title = escapeHtml(event.title || 'Untitled Event');
    const dateDisplay = formatDate(event.date);
    const startTime = escapeHtml(event.start_time || '');
    const endTime = escapeHtml(event.end_time || '');
    const location = escapeHtml(event.location || '');
    const description = escapeHtml(event.description || '');
    const routeUrl = event.route_url || '';
    const sourceUrl = event.source_url || event.details_url || '';
    const heartClass = isSaved ? 'fas saved' : 'far';
    const weatherText = escapeHtml(event.weather || 'TBC');
    const rating = escapeHtml(event.tdu_rating || '');
    const ratingReason = escapeHtml(event.tdu_rating_reason || '');

    const mapLink = location ? `https://maps.google.com/?q=${encodeURIComponent(event.location)}` : '';

    let timeRange = startTime;
    if (startTime && endTime) {
        timeRange += ` - ${endTime}`;
    }

    return `
        <div class="event-card">
            <button class="fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave('${escapeHtml(eventId)}', this)" aria-label="Save event">
                <i class="${heartClass} fa-heart" aria-hidden="true"></i>
            </button>

            ${createTagChips(event)}
            <h3>${title}</h3>

            <div class="event-meta">
                ${dateDisplay || timeRange ? `<span><i class="far fa-calendar" aria-hidden="true"></i> ${escapeHtml(dateDisplay)}${dateDisplay && timeRange ? ' • ' : ''}${timeRange}</span>` : ''}
                ${location ? `<span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${location}</span>` : ''}
                <span><i class="fas fa-flag-checkered" aria-hidden="true"></i> ${escapeHtml(event.status || 'upcoming')}</span>
                <span class="event-weather"><i class="fas fa-cloud-sun" aria-hidden="true"></i> Weather: ${weatherText}</span>
            </div>

            ${createHighlightChips(event)}
            ${description ? `<div class="event-desc">${description}</div>` : ''}
            ${rating && ratingReason ? `<div class="event-note"><strong>${rating}</strong> — ${ratingReason}</div>` : ''}

            <div class="card-actions">
                ${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener noreferrer" class="btn"><i class="fas fa-directions" aria-hidden="true"></i> Navigate</a>` : ''}
                ${routeUrl ? `<a href="${routeUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary"><i class="fas fa-route" aria-hidden="true"></i> Route</a>` : ''}
                ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="btn"><i class="fas fa-up-right-from-square" aria-hidden="true"></i> Source</a>` : ''}
            </div>
        </div>
    `;
}

function renderFeaturedEvents() {
    const section = document.getElementById('featured-events-section');
    const container = document.getElementById('featured-events-container');
    if (!section || !container) return;

    const featuredEvents = allEvents.filter((event) => event.featured);
    if (!featuredEvents.length) {
        section.hidden = true;
        container.innerHTML = '';
        return;
    }

    section.hidden = false;
    container.innerHTML = featuredEvents.map((event) => `
        <button class="featured-event-card" type="button" onclick="openScheduleForEvent('${escapeHtml(event.id)}')">
            <div class="featured-event-top">
                <div>
                    <h3>${escapeHtml(event.title)}</h3>
                    <p class="featured-event-meta">${escapeHtml(event.type || event.category || 'Event')} • ${escapeHtml(formatDate(event.date))}</p>
                </div>
                <span class="tag tag-featured">Featured</span>
            </div>
            <p>${escapeHtml(event.location || event.tdu_rating_reason || '')}</p>
            <div class="featured-link">Open in schedule</div>
        </button>
    `).join('');
}

function renderSchedule() {
    const container = document.getElementById('events-container');
    if (!container) return;
    container.innerHTML = '';

    const displayEvents = getFilteredEvents();
    if (displayEvents.length === 0) {
        container.innerHTML = createEmptyStateHTML();
        return;
    }

    const savedEvents = getSavedEvents();
    displayEvents.forEach((event, index) => {
        const eventId = String(event.id || index + 1);
        const isSaved = savedEvents.includes(eventId);
        container.innerHTML += createEventCardHTML(event, eventId, isSaved);
    });
}

function renderSaved() {
    const container = document.getElementById('saved-events-container');
    if (!container) return;
    container.innerHTML = '';

    const savedEvents = getSavedEvents();
    const displayEvents = allEvents.filter((event) => savedEvents.includes(String(event.id)));

    if (displayEvents.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="far fa-heart" aria-hidden="true"></i>
                <p><strong>Your itinerary is empty</strong><br>Tap the heart icon on any event in the Schedule to save it to My TDU.</p>
            </div>
        `;
        return;
    }

    displayEvents.forEach((event, index) => {
        const eventId = String(event.id || index + 1);
        container.innerHTML += createEventCardHTML(event, eventId, true);
    });
}

function exportSavedEvents() {
    const savedEventIds = getSavedEvents();
    const selectedEvents = allEvents.filter((event) => savedEventIds.includes(String(event.id)));

    if (!selectedEvents.length) {
        alert('No saved events to export yet.');
        return;
    }

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TDU PWA//EN',
        'CALSCALE:GREGORIAN'
    ];

    selectedEvents.forEach((event, index) => {
        const summary = event.title || 'TDU Event';
        const description = event.description || '';
        const location = event.location || '';
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

    const icsContent = lines.join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'my-tdu-itinerary.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function fetchEvents() {
    try {
        const response = await fetch(`./events.json?t=${Date.now()}`);
        if (!response.ok) throw new Error('Could not load events.json');
        const events = await response.json();
        allEvents = sortEvents(events.map((event, index) => normalizeEvent(event, index)));
        renderCategoryFilters();
        renderFeaturedEvents();
        updateSavedBadge();
        renderSchedule();
        renderSaved();
    } catch (error) {
        console.error('Fetch Error:', error);
        const container = document.getElementById('events-container');
        if (container) {
            container.innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${escapeHtml(error.message)}</p>`;
        }
    }
}

window.toggleSave = function(id, btnElement) {
    let savedEvents = getSavedEvents();
    const strId = String(id);

    if (savedEvents.includes(strId)) {
        savedEvents = savedEvents.filter((eventId) => eventId !== strId);
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '<i class="far fa-heart" aria-hidden="true"></i>';
        }
    } else {
        savedEvents.push(strId);
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '<i class="fas fa-heart" aria-hidden="true"></i>';
        }
    }

    localStorage.setItem('savedTDU', JSON.stringify(savedEvents));
    updateSavedBadge();

    const activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-saved') {
        renderSaved();
    }
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
        if (homeCount) {
            homeCount.innerText = `${savedEvents.length} event${savedEvents.length > 1 ? 's' : ''} saved`;
        }
    } else {
        if (badge) badge.style.display = 'none';
        if (homeCount) homeCount.innerText = '0 events saved';
    }
}

window.showView = function(viewName) {
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));

    const viewEl = document.getElementById(`view-${viewName}`);
    const navEl = document.getElementById(`nav-${viewName}`);
    if (viewEl) viewEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    if (viewName === 'schedule') {
        renderSchedule();
    } else if (viewName === 'saved') {
        renderSaved();
    }
    window.scrollTo(0, 0);
};

window.setFilterType = function(type) {
    const target = document.getElementById(type === 'category' ? 'category-filters' : 'day-filters');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
};

window.applyDayFilter = function(day, btn) {
    currentDayFilter = day;
    document.querySelectorAll('#day-filters .filter-btn').forEach((button) => button.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
    } else {
        document.querySelectorAll('#day-filters .filter-btn').forEach((button) => {
            if (button.textContent === 'All Days' && day === 'All') {
                button.classList.add('active');
            } else if (button.getAttribute('onclick') && button.getAttribute('onclick').includes(`'${day}'`)) {
                button.classList.add('active');
            }
        });
    }
    renderSchedule();
};

window.applyCategoryFilter = function(categoryKey, btn) {
    currentCatFilter = categoryKey;
    document.querySelectorAll('#category-filters .filter-btn').forEach((button) => button.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSchedule();
};

window.applySearch = function(value) {
    currentSearchTerm = String(value || '');
    renderSchedule();
};

window.openScheduleForEvent = function(eventId) {
    const event = allEvents.find((item) => item.id === String(eventId));
    if (!event) {
        showView('schedule');
        return;
    }

    currentDayFilter = event.date || 'All';
    currentCatFilter = getCategoryFilterDefinitions(allEvents).some((definition) => definition.key === `type:${event.type}`)
        ? `type:${event.type}`
        : getCategoryFilterDefinitions(allEvents).some((definition) => definition.key === `category:${event.category}`)
            ? `category:${event.category}`
            : 'All';
    currentSearchTerm = '';

    setSearchInputValue('');
    applyDayFilter(currentDayFilter);
    renderCategoryFilters();
    renderSchedule();
    showView('schedule');
};

function checkPWAStatus() {
    const btn = document.getElementById('header-install-btn');
    if (!btn) return;

    if (isStandalone) {
        btn.style.display = 'none';
    } else if (isIOS) {
        btn.style.display = 'flex';
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('header-install-btn');
    if (btn && !isStandalone) {
        btn.style.display = 'flex';
    }
});

window.triggerInstall = function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((result) => {
            if (result.outcome === 'accepted') {
                const btn = document.getElementById('header-install-btn');
                if (btn) btn.style.display = 'none';
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

window.exportSavedEvents = exportSavedEvents;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    });
}

checkPWAStatus();
updateWeatherWidget();
fetchEvents();
