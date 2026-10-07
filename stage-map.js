// Stage checkpoint map (Leaflet + leaflet-ant-path) and elevation profile (Chart.js).
// Libraries load from CDNJS only when a user opens a stage map.
(function () {
    const ELEVATION_CACHE_KEY = 'tduCheckpointElevationV1';
    const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
    const PATH_STYLE = { color: '#003865', weight: 4, opacity: 0.85 };

    let map = null;
    let elevationChart = null;
    let openToken = 0;

    function getElement(id) {
        return document.getElementById(id);
    }

    function setStatus(message) {
        const status = getElement('stage-map-status');
        if (status) status.textContent = message || '';
    }

    function isCurrent(token) {
        return token === openToken;
    }

    function destroyVisuals() {
        if (map) {
            map.remove();
            map = null;
        }
        if (elevationChart) {
            elevationChart.destroy();
            elevationChart = null;
        }
    }

    function buildPopupHTML(checkpoint) {
        const times = checkpoint.passTimes.length ? `<br>Passes: ${escapeHTML(checkpoint.passTimes.join(', '))}` : '';
        const description = checkpoint.description ? `<br>${escapeHTML(checkpoint.description)}` : '';
        return `<strong>${escapeHTML(checkpoint.name)}</strong>${times}${description}`;
    }

    async function drawPath(L, latlngs, token) {
        try {
            const antPath = await window.TDUCdn.load('antPath');
            if (!isCurrent(token) || !map) return;
            antPath(latlngs, {
                ...PATH_STYLE,
                delay: 800,
                dashArray: [10, 20],
                pulseColor: '#FFFFFF',
                paused: window.TDUCdn.prefersReducedMotion(),
                hardwareAccelerated: true
            }).addTo(map);
        } catch (error) {
            if (!isCurrent(token) || !map) return;
            L.polyline(latlngs, { ...PATH_STYLE, dashArray: '8 10' }).addTo(map);
        }
    }

    async function renderMap(checkpoints, token) {
        const container = getElement('stage-map');
        if (!container) return;

        let L;
        try {
            L = await window.TDUCdn.load('leaflet');
        } catch (error) {
            if (isCurrent(token)) setStatus('Map unavailable right now. Check your connection and try again.');
            return;
        }
        if (!isCurrent(token)) return;

        if (map) {
            map.remove();
            map = null;
        }

        const latlngs = checkpoints.map((checkpoint) => [checkpoint.lat, checkpoint.lng]);
        map = L.map(container, { scrollWheelZoom: false });
        L.tileLayer(TILE_URL, { maxZoom: 19, subdomains: 'abcd', attribution: TILE_ATTRIBUTION }).addTo(map);

        checkpoints.forEach((checkpoint) => {
            L.circleMarker([checkpoint.lat, checkpoint.lng], {
                radius: 8,
                color: '#ffffff',
                weight: 2.5,
                fillColor: '#f26522',
                fillOpacity: 1.0
            }).bindPopup(buildPopupHTML(checkpoint)).addTo(map);
        });

        if (latlngs.length > 1) {
            map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
            drawPath(L, latlngs, token);
        } else {
            map.setView(latlngs[0], 13);
        }

        // The modal animates in, so recalculate the map size once it has settled.
        setTimeout(() => {
            if (map && isCurrent(token)) map.invalidateSize();
        }, 250);
        setStatus('');
    }

    function readElevationCache() {
        try {
            const parsed = JSON.parse(localStorage.getItem(ELEVATION_CACHE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    async function getCheckpointElevations(checkpoints) {
        const cacheKey = checkpoints.map((checkpoint) => `${checkpoint.lat.toFixed(4)},${checkpoint.lng.toFixed(4)}`).join('|');
        const cache = readElevationCache();
        if (Array.isArray(cache[cacheKey]) && cache[cacheKey].length === checkpoints.length) {
            return cache[cacheKey];
        }

        const params = new URLSearchParams({
            latitude: checkpoints.map((checkpoint) => checkpoint.lat.toFixed(4)).join(','),
            longitude: checkpoints.map((checkpoint) => checkpoint.lng.toFixed(4)).join(',')
        });
        const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params.toString()}`);
        if (!response.ok) throw new Error('Elevation request failed');

        const data = await response.json();
        const elevations = Array.isArray(data && data.elevation) ? data.elevation.map(Number) : [];
        if (elevations.length !== checkpoints.length || elevations.some((value) => !Number.isFinite(value))) {
            throw new Error('Unexpected elevation response');
        }

        try {
            cache[cacheKey] = elevations;
            localStorage.setItem(ELEVATION_CACHE_KEY, JSON.stringify(cache));
        } catch (error) {
            // Storage full or unavailable; the chart still renders this time.
        }
        return elevations;
    }

    function shortenLabel(label) {
        return label.length > 14 ? `${label.slice(0, 13)}…` : label;
    }

    async function renderElevation(checkpoints, token) {
        const section = getElement('stage-elevation');
        const canvas = getElement('stage-elevation-chart');
        if (!section || !canvas) return;

        if (checkpoints.length < 2) {
            section.hidden = true;
            return;
        }
        section.hidden = false;

        let Chart;
        let elevations;
        try {
            [Chart, elevations] = await Promise.all([
                window.TDUCdn.load('chart'),
                getCheckpointElevations(checkpoints)
            ]);
        } catch (error) {
            if (isCurrent(token)) section.hidden = true;
            return;
        }
        if (!isCurrent(token)) return;

        if (elevationChart) elevationChart.destroy();
        const labels = checkpoints.map((checkpoint) => checkpoint.name);
        canvas.setAttribute('aria-label', `Checkpoint elevations: ${labels.map((label, index) => `${label} ${Math.round(elevations[index])} m`).join(', ')}`);

        elevationChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Elevation (m)',
                    data: elevations,
                    borderColor: '#003865',
                    backgroundColor: 'rgba(227, 82, 5, 0.18)',
                    pointBackgroundColor: '#E35205',
                    fill: true,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: window.TDUCdn.prefersReducedMotion() ? false : { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${Math.round(context.parsed.y)} m`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 0,
                            autoSkip: true,
                            callback(value) {
                                return shortenLabel(String(this.getLabelForValue(value)));
                            }
                        }
                    },
                    y: {
                        title: { display: true, text: 'm' }
                    }
                }
            }
        });
    }

    window.openStageMap = function (eventId) {
        const strId = String(eventId);
        const event = allEvents.find((item) => String(item.id) === strId);
        const checkpoints = getStageMapCheckpoints(event);
        const modal = getElement('stage-map-modal');
        if (!event || !checkpoints.length || !modal) return;

        openToken += 1;
        const token = openToken;
        destroyVisuals();

        const title = getElement('stage-map-title');
        if (title) title.textContent = event.title || 'Stage map';
        setStatus('Loading map…');

        modal.classList.add('active');
        const closeButton = modal.querySelector('.close-btn');
        if (closeButton) closeButton.focus();

        trackAnalyticsEvent('open_stage_map', getEventAnalyticsPayload(strId));
        renderMap(checkpoints, token);
        renderElevation(checkpoints, token);
    };

    window.closeStageMap = function (e) {
        if (e && !e.target.classList.contains('modal-overlay') && !e.target.classList.contains('close-btn')) return;
        const modal = getElement('stage-map-modal');
        if (!modal || !modal.classList.contains('active')) return;
        modal.classList.remove('active');
        openToken += 1;
        destroyVisuals();
        setStatus('');
    };

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.closeStageMap();
    });
}());
