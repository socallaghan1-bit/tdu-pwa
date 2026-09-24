let allEvents = [];
let currentDayFilter = 'All';
let currentCatFilter = 'All';
let currentSearchQuery = '';
let selectedEventId = null;
let deferredPrompt = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ADL_WEATHER_PLACEHOLDER = 'Today in Adelaide: 24°C • Partly cloudy';

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

function extractDistance(description) {
    const match = String(description || '').match(/(\d+(?:\.\d+)?)\s*km/i);
    return match ? Number(match[1]) : null;
}

function normalizeStageType(value) {
    const lowerValue = String(value || '').toLowerCase();
    if (lowerValue.includes('women')) return "Women's Stage";
    if (lowerValue.includes('men')) return "Men's Stage";
    return '';
}

function inferDifficulty(category, distanceKm) {
    if (category === 'Race Stage') {
        if (typeof distanceKm === 'number' && distanceKm <= 90) return 'Moderate';
        return 'Hard';
    }
    return 'Moderate';
}

function inferTags(event, category, type) {
    const haystack = `${event.title || ''} ${event.description || ''} ${event.location || ''}`.toLowerCase();
    const tags = new Set();

    if (category === 'Race Stage') {
        tags.add('race');
        tags.add('stage');
        tags.add('spectator');
    }
    if (type === "Men's Stage") tags.add('men');
    if (type === "Women's Stage") tags.add('women');
    if (/hill|hills|mount lofty|corkscrew|summit|stirling/.test(haystack)) tags.add('hills');
    if (/beach|glenelg|henley|esplanade|coastal/.test(haystack)) tags.add('coastal');
    if (/victor harbor|willunga|mclaren vale/.test(haystack)) tags.add('iconic');
    if (/angaston|tanunda|barossa/.test(haystack)) tags.add('barossa');

    return Array.from(tags);
}

function normalizeEvent(event, index) {
    const normalized = event && typeof event === 'object' ? { ...event } : {};
    const type = normalized.type || normalizeStageType(normalized.category);
    const category = normalized.category && normalized.category !== type
        ? normalized.category
        : (type ? 'Race Stage' : normalized.category || 'General');
    const distanceKm = typeof normalized.distance_km === 'number'
        ? normalized.distance_km
        : extractDistance(normalized.description);
    const sourceUrl = normalized.source_url || normalized.details_url || '';
    const tags = Array.isArray(normalized.tags) && normalized.tags.length
        ? normalized.tags.map(tag => String(tag).trim()).filter(Boolean)
        : inferTags(normalized, category, type);

    return {
        ...normalized,
        id: String(normalized.id || `event-${index + 1}`),
        category,
        type,
        distance_km: typeof distanceKm === 'number' && !Number.isNaN(distanceKm) ? distanceKm : null,
        difficulty: normalized.difficulty || inferDifficulty(category, distanceKm),
        tags,
        featured: Boolean(normalized.featured),
        status: normalized.status || 'upcoming',
        source_url: sourceUrl,
        details_url: normalized.details_url || sourceUrl
    };
}

async function fetchEvents() {
    try {
        const response = await fetch('./events.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Could not load events.json');
        const events = await response.json();
        allEvents = Array.isArray(events) ? events.map(normalizeEvent) : [];
        updateSavedBadge();
        renderFilterControls();
        renderFeaturedEvents();
        renderSchedule();
    } catch (error) {
        console.error('Fetch Error:', error);
        const container = document.getElementById('events-container');
        if (container) {
            container.innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${escapeHtml(error.message)}</p>`;
        }
    }
}

function getDateOptions() {
    const dates = Array.from(new Set(allEvents.map(event => event.date).filter(Boolean)));
    return dates.sort();
}

function getCategoryOptions() {
    const optionSet = new Set();
    allEvents.forEach((event) => {
        if (event.category) optionSet.add(event.category);
        if (event.type) optionSet.add(event.type);
    });

    const preferred = ['Race Stage', "Men's Stage", "Women's Stage"];
    const ordered = preferred.filter(option => optionSet.has(option));
    const extra = Array.from(optionSet)
        .filter(option => !preferred.includes(option))
        .sort((a, b) => a.localeCompare(b));

    return ordered.concat(extra);
}

function createFilterButton(value, text, isActive, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-btn${isActive ? ' active' : ''}`;
    button.dataset.value = value;
    button.setAttribute('aria-pressed', String(isActive));
    button.textContent = text;
    button.addEventListener('click', () => onClick(value));
    return button;
}

function updateFilterButtonState(containerId, activeValue) {
    document.querySelectorAll(`#${containerId} .filter-btn`).forEach((button) => {
        const isActive = button.dataset.value === activeValue;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

function renderFilterControls() {
    const dayFilters = document.getElementById('day-filters');
    const categoryFilters = document.getElementById('category-filters');
    if (!dayFilters || !categoryFilters) return;

    dayFilters.innerHTML = '';
    categoryFilters.innerHTML = '';

    dayFilters.appendChild(createFilterButton('All', 'All Days', currentDayFilter === 'All', applyDayFilter));
    getDateOptions().forEach((date) => {
        dayFilters.appendChild(createFilterButton(date, formatDate(date), currentDayFilter === date, applyDayFilter));
    });

    categoryFilters.appendChild(createFilterButton('All', 'All Events', currentCatFilter === 'All', applyCategoryFilter));
    getCategoryOptions().forEach((category) => {
        categoryFilters.appendChild(createFilterButton(category, category, currentCatFilter === category, applyCategoryFilter));
    });
}

function matchesSearch(event, query) {
    if (!query) return true;
    const tokens = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;

    const searchable = [
        event.title,
        event.location,
        event.description,
        event.category,
        event.type,
        Array.isArray(event.tags) ? event.tags.join(' ') : ''
    ].join(' ').toLowerCase();

    return tokens.every(token => searchable.includes(token));
}

function matchesCategory(event, value) {
    if (value === 'All') return true;
    return event.category === value || event.type === value;
}

function createEmptyState(container) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'empty-state';

    const icon = document.createElement('i');
    icon.className = 'fas fa-search';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('p');
    title.className = 'empty-state-title';
    title.textContent = 'No events match this search yet';

    const body = document.createElement('p');
    body.className = 'empty-state-body';
    body.textContent = currentSearchQuery || currentDayFilter !== 'All' || currentCatFilter !== 'All'
        ? 'Try clearing your search or changing the date/category filters.'
        : 'Add more events to events.json to see them here.';

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(body);
    container.appendChild(card);
}

function scrollToSelectedEvent() {
    if (!selectedEventId) return;
    const card = document.querySelector('.event-card-focused');
    if (!card) return;
    requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function renderSchedule() {
    const container = document.getElementById('events-container');
    if (!container) return;
    container.innerHTML = '';

    const displayEvents = allEvents.filter((event) => {
        const matchesDay = currentDayFilter === 'All' || event.date === currentDayFilter;
        return matchesDay && matchesCategory(event, currentCatFilter) && matchesSearch(event, currentSearchQuery);
    });

    if (!displayEvents.length) {
        createEmptyState(container);
        return;
    }

    const savedEvents = getSavedEvents();
    container.innerHTML = displayEvents.map((event, index) => {
        const eventId = String(event.id || index + 1);
        const isSaved = savedEvents.includes(eventId);
        return createEventCardHTML(event, eventId, isSaved);
    }).join('');

    scrollToSelectedEvent();
}

function renderSaved() {
    const container = document.getElementById('saved-events-container');
    if (!container) return;
    container.innerHTML = '';

    const savedEvents = getSavedEvents();
    const displayEvents = allEvents.filter(e => savedEvents.includes(String(e.id)));

    if (displayEvents.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="far fa-heart" aria-hidden="true"></i>
                <p class="empty-state-title">Your itinerary is empty</p>
                <p class="empty-state-body">Tap the heart icon on any event in the Schedule to save it to My TDU.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = displayEvents.map((event, index) => {
        const eventId = String(event.id || index + 1);
        return createEventCardHTML(event, eventId, true);
    }).join('');
}

function getSaveButtonLabel(title, isSaved) {
    return `${isSaved ? 'Remove' : 'Save'} ${title || 'event'} ${isSaved ? 'from' : 'to'} your itinerary`;
}

function createBadgeHtml(label, modifier) {
    return `<span class="tag${modifier ? ` ${modifier}` : ''}">${escapeHtml(label)}</span>`;
}

function createEventCardHTML(event, eventId, isSaved) {
    const title = event.title || 'Untitled Event';
    const category = event.category || '';
    const type = event.type || '';
    const dateDisplay = formatDate(event.date);
    const startTime = event.start_time || '';
    const endTime = event.end_time || '';
    const location = event.location || '';
    const description = event.description || '';
    const routeUrl = event.route_url || '';
    const sourceUrl = event.source_url || event.details_url || '';
    const heartClass = isSaved ? 'fas saved' : 'far';
    const weatherText = event.weather || 'TBC';
    const distanceText = typeof event.distance_km === 'number' ? `${event.distance_km.toFixed(1)} km` : '';
    const difficultyText = event.difficulty || '';
    const mapLink = location ? `https://maps.google.com/?q=${encodeURIComponent(location)}` : '#';
    const badges = [];

    if (category) badges.push(createBadgeHtml(category));
    if (type) badges.push(createBadgeHtml(type, 'tag-secondary'));
    if (event.featured) badges.push(createBadgeHtml('Featured', 'tag-featured'));

    let timeRange = startTime;
    if (startTime && endTime) {
        timeRange += ' - ' + endTime;
    }

    return `
        <div class="event-card${selectedEventId === eventId ? ' event-card-focused' : ''}" data-event-id="${escapeHtml(eventId)}">
            <button class="fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave('${escapeHtml(eventId)}', this)" aria-label="${escapeHtml(getSaveButtonLabel(title, isSaved))}">
                <i class="${heartClass} fa-heart" aria-hidden="true"></i>
            </button>

            ${badges.length ? `<div class="tag-row">${badges.join('')}</div>` : ''}
            <h3>${escapeHtml(title)}</h3>

            <div class="event-meta">
                ${dateDisplay || timeRange ? `<span><i class="far fa-calendar" aria-hidden="true"></i> ${escapeHtml(dateDisplay)}${dateDisplay && timeRange ? ' • ' : ''}${escapeHtml(timeRange)}</span>` : ''}
                ${location ? `<span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${escapeHtml(location)}</span>` : ''}
                ${distanceText || difficultyText ? `<span><i class="fas fa-route" aria-hidden="true"></i> ${escapeHtml([distanceText, difficultyText].filter(Boolean).join(' • '))}</span>` : ''}
                <span class="event-weather"><i class="fas fa-cloud-sun" aria-hidden="true"></i> Weather: ${escapeHtml(weatherText)}</span>
            </div>

            ${description ? `<div class="event-desc">${escapeHtml(description)}</div>` : ''}

            <div class="card-actions">
                ${location ? `<a href="${escapeHtml(mapLink)}" target="_blank" rel="noopener" class="btn"><i class="fas fa-directions" aria-hidden="true"></i> Navigate</a>` : ''}
                ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener" class="btn"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Official Info</a>` : ''}
                ${routeUrl ? `<a href="${escapeHtml(routeUrl)}" target="_blank" rel="noopener" class="btn btn-primary"><i class="fas fa-route" aria-hidden="true"></i> Route</a>` : ''}
            </div>
        </div>
    `;
}

function renderFeaturedEvents() {
    const section = document.getElementById('featured-section');
    const container = document.getElementById('featured-events');
    if (!section || !container) return;

    const featuredEvents = allEvents.filter((event) => event.featured);
    if (!featuredEvents.length) {
        section.hidden = true;
        container.innerHTML = '';
        return;
    }

    section.hidden = false;
    container.innerHTML = featuredEvents.map((event) => {
        const metaParts = [formatDate(event.date), event.type || event.category, typeof event.distance_km === 'number' ? `${event.distance_km.toFixed(1)} km` : ''].filter(Boolean);
        return `
            <article class="featured-card">
                <div class="featured-card-top">
                    <span class="featured-pill">Featured</span>
                    <span class="featured-date">${escapeHtml(formatDate(event.date))}</span>
                </div>
                <h3>${escapeHtml(event.title || 'Featured event')}</h3>
                <p>${escapeHtml(event.location || event.description || '')}</p>
                <div class="featured-meta">${escapeHtml(metaParts.join(' • '))}</div>
                <button type="button" class="btn btn-primary featured-btn" onclick="focusEventInSchedule('${escapeHtml(String(event.id))}')">Open in Schedule</button>
            </article>
        `;
    }).join('');
}

window.toggleSave = function(id, btnElement) {
    let savedEvents = getSavedEvents();
    const strId = String(id);
    const targetEvent = allEvents.find((event) => String(event.id) === strId);
    const title = targetEvent ? targetEvent.title : 'event';

    if (savedEvents.includes(strId)) {
        savedEvents = savedEvents.filter(eventId => eventId !== strId);
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '<i class="far fa-heart" aria-hidden="true"></i>';
            btnElement.setAttribute('aria-label', getSaveButtonLabel(title, false));
        }
    } else {
        savedEvents.push(strId);
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '<i class="fas fa-heart" aria-hidden="true"></i>';
            btnElement.setAttribute('aria-label', getSaveButtonLabel(title, true));
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
        if (homeCount) homeCount.innerText = savedEvents.length + ' event' + (savedEvents.length > 1 ? 's' : '') + ' saved';
    } else {
        if (badge) badge.style.display = 'none';
        if (homeCount) homeCount.innerText = '0 events saved';
    }
}

window.showView = function(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const viewEl = document.getElementById('view-' + viewName);
    const navEl = document.getElementById('nav-' + viewName);
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
    const target = document.getElementById(type === 'day' ? 'day-filter-label' : 'category-filter-label');
    const firstButton = document.querySelector(type === 'day' ? '#day-filters .filter-btn.active' : '#category-filters .filter-btn.active');

    requestAnimationFrame(() => {
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (firstButton) {
            firstButton.focus({ preventScroll: true });
        }
    });
};

window.applyDayFilter = function(day) {
    currentDayFilter = day;
    selectedEventId = null;
    updateFilterButtonState('day-filters', currentDayFilter);
    renderSchedule();
};

window.applyCategoryFilter = function(category) {
    currentCatFilter = category;
    selectedEventId = null;
    updateFilterButtonState('category-filters', currentCatFilter);
    renderSchedule();
};

window.focusEventInSchedule = function(eventId) {
    const event = allEvents.find((item) => String(item.id) === String(eventId));
    if (!event) return;

    selectedEventId = String(event.id);
    currentSearchQuery = '';
    currentDayFilter = event.date || 'All';
    currentCatFilter = event.type || event.category || 'All';

    const searchInput = document.getElementById('event-search');
    if (searchInput) searchInput.value = '';

    updateFilterButtonState('day-filters', currentDayFilter);
    updateFilterButtonState('category-filters', currentCatFilter);
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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js');
    });
}

const searchInput = document.getElementById('event-search');
if (searchInput) {
    searchInput.addEventListener('input', (event) => {
        currentSearchQuery = event.target.value || '';
        selectedEventId = null;
        renderSchedule();
    });
}

checkPWAStatus();
updateWeatherWidget();
fetchEvents();
