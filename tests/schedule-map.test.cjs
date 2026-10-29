const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));

function loadFunction(context, name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(|^window\\.${name} = `, 'm'));
    assert.notEqual(start, -1, `Missing ${name}`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
}

function setup(day = 'All', data = events) {
    const markers = {
        layers: [],
        clearLayers() { this.layers = []; },
        addLayer(layer) { this.layers.push(layer); },
        eachLayer(callback) { this.layers.forEach(callback); }
    };
    const routes = {
        layers: [],
        clearLayers() { this.layers = []; }
    };
    const map = {
        fitBounds(points, options) { this.bounds = points; this.options = options; },
        setView(point, zoom) { this.center = point; this.zoom = zoom; },
        invalidateSize() {},
        flyTo(point, zoom) { this.center = point; this.zoom = zoom; }
    };
    const context = vm.createContext({
        allEvents: data,
        currentDayFilter: day,
        currentLumaFilter: 'All',
        currentSearchQuery: '',
        scheduleMap: map,
        scheduleMarkersLayer: markers,
        scheduleRouteLayer: routes,
        highlightEventCard() {},
        formatTime: (time) => time,
        formatDate: (date) => date,
        window: {
            L: {
                latLngBounds: (points) => points,
                divIcon: (options) => options,
                marker: (point, options) => ({
                    point, options,
                    bindPopup(html) { this.popup = html; return this; },
                    on() { return this; },
                    openPopup() { this.open = true; }
                }),
                polyline: (points, options) => ({
                    points, options,
                    addTo(layer) { layer.layers.push(this); }
                })
            }
        }
    });
    for (const name of [
        'escapeHTML', 'isValidCheckpointCoords', 'parseCoordinates', 'getEventCategoryColor',
        'getFilteredScheduleEvents', 'fitScheduleMapToBounds',
        'buildSchedulePopup', 'updateScheduleMapMarkers'
    ]) loadFunction(context, name);
    return { context, map, markers, routes };
}

test('schedule contains exactly nine retained stages and four located announcements', () => {
    const expected = [
        ...Array.from({ length: 6 }, (_, i) => `2027-men-${i + 1}`),
        ...Array.from({ length: 3 }, (_, i) => `2027-women-${i + 1}`),
        '2027-oceania-tt', '2027-oceania-rr', '2027-opening-concert', '2027-gumeracha-festival'
    ];
    assert.deepEqual(events.map((event) => event.id).sort(), expected.sort());
    const { context } = setup();
    events.forEach((event) => assert.ok(context.parseCoordinates(event.coords), event.id));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    events.forEach((event) => assert.ok(html.includes(`applyDayFilter('${event.date}', this)`)));
});

test('All Days shows only hubs and clears focused routes', () => {
    const { context, markers, routes, map } = setup('2027-01-20');
    context.updateScheduleMapMarkers();
    assert.equal(routes.layers.length, 1);
    context.currentDayFilter = 'All';
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 13);
    assert.equal(routes.layers.length, 0);
    assert.equal(map.options.maxZoom, 13);
    assert.deepEqual(Array.from(map.options.padding), [35, 35]);
});

test('focused day includes typed checkpoints, finish, passes and route', () => {
    const { context, markers, routes, map } = setup('2027-01-20');
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 5);
    assert.equal(routes.layers.length, 1);
    assert.equal(routes.layers[0].points.length, 5);
    for (const type of ['kom', 'sprint', 'feed', 'finish']) {
        assert.ok(markers.layers.some((marker) => marker.options.icon.html.includes(`pin-${type}`)));
    }
    assert.ok(markers.layers[1].popup.includes('Passes: 10:51, 12:01, 13:11'));
    assert.equal(map.bounds.length, 5);
});

test('untyped Stage 1 checkpoints retain KOM and sprint semantics', () => {
    const { context, markers, routes } = setup('2027-01-19');
    context.updateScheduleMapMarkers();
    assert.ok(markers.layers.some((marker) => marker.options.icon.html.includes('pin-kom')));
    assert.ok(markers.layers.some((marker) => marker.options.icon.html.includes('pin-sprint')));
    assert.equal(routes.layers.length, 1);
    assert.equal(routes.layers[0].points.length, 5);
});

test('shared race days draw separate routes without cross-event connections', () => {
    const { context, routes } = setup('2027-01-22');
    context.updateScheduleMapMarkers();
    assert.equal(routes.layers.length, 2);
    assert.deepEqual(routes.layers.map((route) => route.points.length), [7, 7]);
});

test('focused social event keeps its category and list popup without a race route', () => {
    const { context, markers, routes } = setup('2027-01-16');
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 2);
    assert.equal(routes.layers.length, 0);
    const concert = markers.layers.find((marker) => marker.eventId === '2027-opening-concert');
    assert.ok(concert.options.icon.html.includes('fa-beer-mug-empty'));
    assert.ok(concert.popup.includes('View in List'));
});

test('empty results reset camera and invalid coordinates are skipped', () => {
    const { context, map, markers } = setup('2027-01-18');
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 0);
    assert.deepEqual(Array.from(map.center), [-34.9285, 138.6007]);
    assert.equal(map.zoom, 9);
    context.allEvents = [{ id: 'invalid', coords: 'not coordinates' }];
    context.currentDayFilter = 'All';
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 0);
});

test('coordinate fallback works and popup content is escaped', () => {
    const { context, markers } = setup('All', [{
        id: 'fallback', title: '<script>bad()</script>', category: 'Race Stages',
        checkpoints: [{ name: 'Start', coords: '-34.9,138.6' }]
    }]);
    context.updateScheduleMapMarkers();
    assert.equal(markers.layers.length, 1);
    assert.ok(markers.layers[0].popup.includes('&lt;script&gt;'));
    assert.ok(!markers.layers[0].popup.includes('<script>'));
});

test('loading events sorts dates and then start times before rendering', async () => {
    const { context } = setup();
    context.fetch = async () => ({
        ok: true,
        json: async () => [
            { id: 'later-day', date: '2027-01-20', start_time: '08:00' },
            { id: 'later-time', date: '2027-01-16', start_time: '18:00' },
            { id: 'first', date: '2027-01-16', start_time: '08:00' }
        ]
    });
    for (const name of [
        'updateSavedBadge', 'renderFeaturedEvents', 'renderRecommendationFlow',
        'renderSchedule', 'initScheduleMap', 'handleEventDeepLink'
    ]) context[name] = () => {};
    loadFunction(context, 'fetchEvents');
    await context.fetchEvents();
    assert.deepEqual(context.allEvents.map((event) => event.id), ['first', 'later-time', 'later-day']);
});

test('Show on Map synchronizes date buttons, rebuilds layers and opens the focused popup', async () => {
    const { context, map, markers, routes } = setup();
    const buttons = ['All', '2027-01-20'].map((day) => ({
        active: day === 'All',
        getAttribute: () => `applyDayFilter('${day}', this)`,
        classList: { toggle(_className, active) { buttons.find((button) => button.classList === this).active = active; } }
    }));
    context.document = { querySelectorAll: () => buttons };
    context.currentViewName = 'schedule';
    context.isMobileScheduleMapActive = false;
    context.window.innerWidth = 1280;
    context.setTimeout = (callback) => callback();
    context.initScheduleMap = async () => {};
    let rendered = 0;
    context.renderSchedule = () => { rendered++; };
    loadFunction(context, 'matchesSearchQuery');
    loadFunction(context, 'matchesCategoryFilter');
    loadFunction(context, 'panMapToEvent');
    await context.window.panMapToEvent('2027-men-2');
    assert.equal(context.currentDayFilter, '2027-01-20');
    assert.deepEqual(buttons.map((button) => button.active), [false, true]);
    assert.equal(rendered, 1);
    assert.equal(routes.layers.length, 1);
    assert.equal(markers.layers[0].eventId, '2027-men-2');
    assert.ok(markers.layers[0].open);
    assert.deepEqual(Array.from(map.center), [-34.502, 139.034]);
    assert.equal(map.zoom, 14);
});
