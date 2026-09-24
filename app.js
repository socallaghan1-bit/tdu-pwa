let allEvents = [];
let weatherData = {};
let currentDayFilter = 'All';
let currentCatFilter = 'All';
let activeFilterMode = 'day';

let deferredPrompt = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function getCompassDirection(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(degrees / 45) % 8];
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).trim().split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
        }
    }
    return dateStr;
}

async function fetchDailyWeather() {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=-34.9285&longitude=138.6007&daily=temperature_2m_max,wind_speed_10m_max,wind_direction_10m_dominant&timezone=Australia%2FAdelaide';

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.daily && data.daily.time) {
                data.daily.time.forEach((date, i) => {
                    if (data.daily.temperature_2m_max[i] !== null) {
                        weatherData[date] = {
                            temp: Math.round(data.daily.temperature_2m_max[i]),
                            wind: Math.round(data.daily.wind_speed_10m_max[i]),
                            dir: getCompassDirection(data.daily.wind_direction_10m_dominant[i])
                        };
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Live weather fetch unavailable:", e);
    }
    renderSchedule();
}

async function fetchEvents() {
    try {
        const response = await fetch('./events.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error("Could not load events.json");
        allEvents = await response.json();
        updateSavedBadge();
        fetchDailyWeather();
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('events-container').innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${error.message}</p>`;
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

    const savedEvents = JSON.parse(localStorage.getItem('savedTDU') || '[]');

    displayEvents.forEach((event, index) => {
        const eventId = String(event.id || index + 1);
        const isSaved = savedEvents.includes(eventId);
        container.innerHTML += createEventCardHTML(event, eventId, isSaved);
    });
}

function renderSaved() {
    const container = document.getElementById('saved-events-container');
    const exportBtnContainer = document.getElementById('export-btn-container');
    if (!container) return;
    
    container.innerHTML = '';
    if (exportBtnContainer) exportBtnContainer.innerHTML = '';

    const savedEvents = JSON.parse(localStorage.getItem('savedTDU') || '[]');
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

    // Add Export Button
    if (exportBtnContainer) {
        exportBtnContainer.innerHTML = `
            <button class="btn-export" onclick="exportSavedToICS()">
                <i class="far fa-calendar-plus"></i> Export Itinerary to Phone Calendar (.ics)
            </button>
        `;
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

    const mapLink = location ? `https://maps.google.com/?q=${encodeURIComponent(location)}` : '#';

    let timeRange = startTime;
    if (startTime && endTime) {
        timeRange += ' - ' + endTime;
    }

    const dayWeather = weatherData[event.date];

    return `
        <div class="event-card">
            <button class="fav-btn ${isSaved ? 'saved' : ''}" onclick="toggleSave('${eventId}', this)">
                <i class="${heartClass} fa-heart"></i>
            </button>
            
            ${category ? `<span class="tag">${category}</span>` : ''}
            <h3>${title}</h3>
            
            <div class="event-meta">
                ${dateDisplay || timeRange ? `<span><i class="far fa-calendar"></i> ${dateDisplay} ${dateDisplay && timeRange ? ' • ' : ''} ${timeRange}</span>` : ''}
                ${location ? `<span><i class="fas fa-map-marker-alt"></i> ${location}</span>` : ''}
                <span class="card-weather">
                    ${dayWeather ? `
                        <i class="fas fa-temperature-high" style="color:#e67e22;"></i> <strong>${dayWeather.temp}°C</strong>
                        <span class="weather-sep">•</span>
                        <i class="fas fa-wind" style="color:#27ae60;"></i> ${dayWeather.wind} km/h <strong>${dayWeather.dir}</strong>
                    ` : `
                        <i class="fas fa-cloud-sun" style="color:#94a3b8;"></i> Forecast N/A
                    `}
                </span>
            </div>
            
            ${description ? `<div class="event-desc">${description}</div>` : ''}
            
            <div class="card-actions">
                ${location ? `<a href="${mapLink}" target="_blank" class="btn"><i class="fas fa-directions"></i> Navigate</a>` : ''}
                ${routeUrl ? `<a href="${routeUrl}" target="_blank" class="btn btn-primary"><i class="fas fa-route"></i> Route</a>` : ''}
            </div>
        </div>
    `;
}

// CALENDAR ICS EXPORT GENERATOR
window.exportSavedToICS = function() {
    const savedEvents = JSON.parse(localStorage.getItem('savedTDU') || '[]');
    const displayEvents = allEvents.filter(e => savedEvents.includes(String(e.id)));

    if (displayEvents.length === 0) {
        alert("No saved events to export.");
        return;
    }

    let icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TDU 2026 Companion//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH"
    ];

    displayEvents.forEach(e => {
        const rawDate = (e.date || '').replace(/-/g, '');
        if (!rawDate) return;

        let startFormatted = (e.start_time || '09:00').replace(':', '') + '00';
        if (startFormatted.length === 5) startFormatted = '0' + startFormatted;

        let endFormatted = (e.end_time || '').replace(':', '');
        if (endFormatted) {
            endFormatted += '00';
            if (endFormatted.length === 5) endFormatted = '0' + endFormatted;
        } else {
            // Default 2-hour event duration
            let startHour = parseInt(startFormatted.substring(0, 2), 10);
            let endHour = startHour + 2;
            endFormatted = (endHour < 10 ? '0' + endHour : endHour) + startFormatted.substring(2);
        }

        const dtStart = `${rawDate}T${startFormatted}`;
        const dtEnd = `${rawDate}T${endFormatted}`;

        icsContent.push(
            "BEGIN:VEVENT",
            `SUMMARY:${e.title || 'TDU Event'}`,
            `DESCRIPTION:${(e.description || '').replace(/\n/g, ' ')}`,
            `LOCATION:${e.location || 'Adelaide, SA'}`,
            `DTSTART:${dtStart}`,
            `DTEND:${dtEnd}`,
            "END:VEVENT"
        );
    });

    icsContent.push("END:VCALENDAR");

    const blob = new Blob([icsContent.join("\r\n")], { type: 'text/calendar;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', 'My_TDU_2026_Schedule.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.toggleSave = function(id, btnElement) {
    let savedEvents = JSON.parse(localStorage.getItem('savedTDU') || '[]');
    const strId = String(id);
    
    if (savedEvents.includes(strId)) {
        savedEvents = savedEvents.filter(eventId => eventId !== strId);
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '<i class="far fa-heart"></i>';
        }
    } else {
        savedEvents.push(strId);
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '<i class="fas fa-heart"></i>';
        }
    }
    
    localStorage.setItem('savedTDU', JSON.stringify(savedEvents));
    updateSavedBadge();

    const activeView = document.querySelector('.view.active').id;
    if (activeView === 'view-saved') {
        renderSaved();
    }
};

function updateSavedBadge() {
    const savedEvents = JSON.parse(localStorage.getItem('savedTDU') || '[]');
    const badge = document.getElementById('nav-badge');
    const homeCount = document.getElementById('home-saved-count');
    
    if (savedEvents.length > 0) {
        if (badge) {
            badge.innerText = savedEvents.length;
            badge.style.display = 'block';
        }
        if (homeCount) homeCount.innerText = savedEvents.length + " event" + (savedEvents.length > 1 ? "s" : "") + " saved";
    } else {
        if (badge) badge.style.display = 'none';
        if (homeCount) homeCount.innerText = "0 events saved";
    }
}

window.showView = function(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById('view-' + viewName).classList.add('active');
    document.getElementById('nav-' + viewName).classList.add('active');

    if (viewName === 'schedule') {
        renderSchedule();
    } else if (viewName === 'saved') {
        renderSaved();
    }
    window.scrollTo(0, 0);
};

window.setFilterType = function(type) {
    activeFilterMode = type;
    const dayFilters = document.getElementById('day-filters');
    const catFilters = document.getElementById('category-filters');
    const label = document.getElementById('filter-label-text');

    if (type === 'day') {
        dayFilters.style.display = 'flex';
        catFilters.style.display = 'none';
        label.innerText = "Filter by Date";
    } else {
        dayFilters.style.display = 'none';
        catFilters.style.display = 'flex';
        label.innerText = "Filter by Category";
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
fetchEvents();
