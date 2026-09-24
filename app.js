let allEvents = [];
let currentDayFilter = 'All';
let currentCatFilter = 'All';
let activeFilterMode = 'day';

let deferredPrompt = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

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

async function fetchEvents() {
    try {
        const response = await fetch('./events.json?t=' + new Date().getTime());
        if (!response.ok) throw new Error("Could not load events.json");
        allEvents = await response.json();
        updateSavedBadge();
        renderSchedule();
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('events-container').innerHTML = `<p style='text-align:center; padding:20px; color:red;'>Error: ${error.message}</p>`;
    }
}

function renderSchedule() {
    const container = document.getElementById('events-container');
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
    container.innerHTML = '';

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
            </div>
            
            ${description ? `<div class="event-desc">${description}</div>` : ''}
            
            <div class="card-actions">
                ${location ? `<a href="${mapLink}" target="_blank" class="btn"><i class="fas fa-directions"></i> Navigate</a>` : ''}
                ${routeUrl ? `<a href="${routeUrl}" target="_blank" class="btn btn-primary"><i class="fas fa-route"></i> Route</a>` : ''}
            </div>
        </div>
    `;
}

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
        badge.innerText = savedEvents.length;
        badge.style.display = 'block';
        if (homeCount) homeCount.innerText = savedEvents.length + " event" + (savedEvents.length > 1 ? "s" : "") + " saved";
    } else {
        badge.style.display = 'none';
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

// PWA SMART INSTALL DETECTION
function checkPWAStatus() {
    const btn = document.getElementById('header-install-btn');
    if (!btn) return;

    if (isStandalone) {
        btn.style.display = 'none'; // Hide if already running as installed app
    } else if (isIOS) {
        btn.style.display = 'flex'; // Always show for iOS Safari users
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('header-install-btn');
    if (btn && !isStandalone) {
        btn.style.display = 'flex'; // Show on Android Chrome
    }
});

window.triggerInstall = function() {
    if (deferredPrompt) {
        // Android / Chrome 1-tap install
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((result) => {
            if (result.outcome === 'accepted') {
                const btn = document.getElementById('header-install-btn');
                if (btn) btn.style.display = 'none';
            }
            deferredPrompt = null;
        });
    } else {
        // iOS or manual fallback
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
