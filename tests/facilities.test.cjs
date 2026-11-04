const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const facilities = JSON.parse(fs.readFileSync(path.join(root, 'facilities.json'), 'utf8'));

function loadFunction(context, name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `Missing ${name}`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
}

function setup() {
    const layer = () => ({ layers: [], clearLayers() { this.layers = []; }, addLayer(l) { this.layers.push(l); } });
    const context = vm.createContext({
        waterLayer: layer(),
        toiletLayer: layer(),
        facilitiesData: null,
        window: {
            L: {
                divIcon: (options) => options,
                marker: (point, options) => ({ point, options, bindPopup(html) { this.popup = html; return this; } })
            }
        }
    });
    const constants = source.match(/^const FACILITY_TYPES = \{[\s\S]*?\n\};/m);
    assert.ok(constants, 'Missing FACILITY_TYPES');
    vm.runInContext(constants[0].replace('const ', 'var '), context);
    for (const name of ['escapeHTML', 'normalizeFacilities', 'buildFacilityPopup', 'renderFacilityLayers']) loadFunction(context, name);
    return context;
}

test('facilities.json entries are valid, unique and cover water and toilets', () => {
    const ids = new Set();
    facilities.forEach((f) => {
        assert.match(f.id, /^fac-[a-z0-9-]+$/);
        assert.ok(!ids.has(f.id), `duplicate ${f.id}`);
        ids.add(f.id);
        assert.ok(['water', 'toilet'].includes(f.type), f.id);
        assert.ok(f.name && f.notes, f.id);
        // South Australian race area bounds.
        assert.ok(f.lat < -34 && f.lat > -36 && f.lng > 138 && f.lng < 139.5, f.id);
    });
    assert.ok(facilities.some((f) => f.type === 'water'));
    assert.ok(facilities.some((f) => f.type === 'toilet'));
});

test('facility markers are split into water and toilet layers with directions popups', () => {
    const context = setup();
    context.renderFacilityLayers(context.normalizeFacilities(facilities));
    const water = context.waterLayer.layers;
    const toilets = context.toiletLayer.layers;
    assert.equal(water.length + toilets.length, facilities.length);
    assert.ok(water.every((m) => m.options.icon.html.includes('fa-droplet') && m.options.icon.html.includes('facility-pin-water')));
    assert.ok(toilets.every((m) => m.options.icon.html.includes('fa-restroom') && m.options.icon.html.includes('facility-pin-toilet')));
    const first = water[0];
    assert.ok(first.popup.includes(`https://www.google.com/maps/dir/?api=1&destination=${first.point[0]},${first.point[1]}`));
    assert.ok(first.popup.includes('Get Directions'));
});

test('invalid facilities are dropped and text is escaped', () => {
    const context = setup();
    const result = context.normalizeFacilities([
        { id: 'a', name: '<b>x</b>', type: 'water', lat: -35, lng: 138.5, notes: '<script>' },
        { id: 'b', type: 'bar', lat: -35, lng: 138 },
        { id: 'c', type: 'toilet', lat: 'nope', lng: 138 }
    ]);
    assert.equal(result.length, 1);
    const html = context.buildFacilityPopup(result[0]);
    assert.ok(!html.includes('<b>') && !html.includes('<script>'));
});

test('service worker precaches facilities.json', () => {
    const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
    assert.match(sw, /'\.\/facilities\.json'/);
    assert.match(sw, /CACHE_NAME = 'tdu-pwa-v18'/);
});
