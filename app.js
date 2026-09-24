let allEvents = [];
let currentDayFilter = 'All';
let currentCatFilter = 'All';
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

async function fetchEvents() {
    try {
        const response = await fetch('./events.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error('Could not load events.json');
        allEvents = await response.json();
        updateSavedBadge();
        renderSchedule();
    } catch (error) {
        console.error('Fetch Error:', error);
        const container = document.getElementById('events-container');
        if (container) {
            container.innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${error.message}</p>`;
        }
    }
}

function renderSchedule() {
    const container = document.getElementById('events-container');
    if (!container) return;
    container.innerHTML = '';

    let displayEvents = allEvents;

    if (currentDayFilter !== 'All') {
        displayEvents = displayEvents.filter(e => e.date === currentDayFilter);
    }

    if (currentCatFilter !== 'All') {
        displayEvents = displayEvents.filter(e => e.category && e.category.toLowerCase().includes(currentCatFilter.toLowerCase()));
    }

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
}

function renderSaved() {
    const container = document.getElementById('saved-events-container');
    if (!container) return;
    container.innerHTML = '';

    const savedEvents = getSavedEvents();
    const displayEvents = allEvents.filter(e => savedEvents.includes(String(e.id)));

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

function createEventCardHTML(event, eventId, isSaved) {
    const title = event.title || 'Untitled Event';
    const category = event.category || '';
    const dateDisplay = formatDate(event.date);
    const startTime = event.start_time || '';
    const endTime = event.end_time || '';
    const location = event.location || '';
    const description = event.description || '';
    const routeUrl = event.route_url || '';
    const heartClass = isSaved ? 'fas saved' : 'far';
    const weatherText = event.weather || 'TBC';

    const mapLink = location ? `https://maps.google.com/?q=${encodeURIComponent(location)}` : '#';

    let timeRange = startTime;
    if (startTime && endTime) {
        timeRange += ' - ' + endTime;
    }

    return `
        <div class="event-card">
            <button class="fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave('${eventId}', this)" aria-label="Save event">
                <i class="${heartClass} fa-heart" aria-hidden="true"></i>
            </button>

            ${category ? `<span class="tag">${category}</span>` : ''}
            <h3>${title}</h3>

            <div class="event-meta">
                ${dateDisplay || timeRange ? `<span><i class="far fa-calendar" aria-hidden="true"></i> ${dateDisplay} ${dateDisplay && timeRange ? ' • ' : ''} ${timeRange}</span>` : ''}
                ${location ? `<span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${location}</span>` : ''}
                <span class="event-weather"><i class="fas fa-cloud-sun" aria-hidden="true"></i> Weather: ${weatherText}</span>
            </div>

            ${description ? `<div class="event-desc">${description}</div>` : ''}

            <div class="card-actions">
                ${location ? `<a href="${mapLink}" target="_blank" rel="noopener" class="btn"><i class="fas fa-directions" aria-hidden="true"></i> Navigate</a>` : ''}
                ${routeUrl ? `<a href="${routeUrl}" target="_blank" rel="noopener" class="btn btn-primary"><i class="fas fa-route" aria-hidden="true"></i> Route</a>` : ''}
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
    currentDayFilter = day;
    document.querySelectorAll('#day-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSchedule();
};

window.applyCategoryFilter = function(category, btn) {
    currentCatFilter = category;
    document.querySelectorAll('#category-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSchedule();
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

checkPWAStatus();
updateWeatherWidget();
fetchEvents();
