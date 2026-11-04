const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));

function loadFunctions(names) {
    const context = vm.createContext({});
    names.forEach((name) => {
        const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
        assert.notEqual(start, -1, `Missing ${name}`);
        vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    });
    return context;
}

const ctx = loadFunctions(['escapeHTML', 'getStageGpxUrl', 'getGpxDownloadName', 'renderStageGpxLink']);
const raceStages = events.filter((event) => event.type === 'Race Stage' && Array.isArray(event.checkpoints) && event.checkpoints.length);

test('every race stage links to a bundled, well-formed GPX file', () => {
    assert.ok(raceStages.length > 0);
    raceStages.forEach((stage) => {
        assert.match(stage.gpx_url, /^\.\/routes\/stage-\d\.gpx$/, stage.id);
        const xml = fs.readFileSync(path.join(root, stage.gpx_url), 'utf8');
        assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<gpx version="1\.1"/);
        assert.match(xml, /<metadata>[\s\S]*<name>[^<]+<\/name>[\s\S]*<\/metadata>/);
        assert.ok((xml.match(/<trkpt /g) || []).length >= 2, `${stage.gpx_url} needs a track`);
        assert.match(xml, /<\/gpx>\s*$/);
    });
});

test('service worker precaches every GPX route file', () => {
    const files = fs.readdirSync(path.join(root, 'routes')).filter((file) => file.endsWith('.gpx'));
    assert.ok(files.length >= 6);
    files.forEach((file) => assert.ok(swSource.includes(`'./routes/${file}'`), `${file} missing from GPX_ROUTES`));
});

test('getStageGpxUrl only accepts bundled route files', () => {
    assert.equal(ctx.getStageGpxUrl({ gpx_url: './routes/stage-1.gpx' }), './routes/stage-1.gpx');
    assert.equal(ctx.getStageGpxUrl({ gpx_url: 'https://evil.example/x.gpx' }), '');
    assert.equal(ctx.getStageGpxUrl({ gpx_url: './routes/../admin.html' }), '');
    assert.equal(ctx.getStageGpxUrl({ gpx_url: 'javascript:alert(1)' }), '');
    assert.equal(ctx.getStageGpxUrl({}), '');
    assert.equal(ctx.getStageGpxUrl(null), '');
});

test('download link uses the HTML5 download attribute with a safe filename', () => {
    const stage = events.find((event) => event.id === '2027-men-1');
    assert.equal(ctx.getGpxDownloadName(stage), 'TDU-2027-THINK-Road-Safety-Race-Day-1-Henley-Beach-to-Gumeracha.gpx');
    assert.equal(ctx.getGpxDownloadName({ name: 'Stage 3' }), 'TDU-2027-Stage-3.gpx');

    const html = ctx.renderStageGpxLink(stage, '2027-men-1');
    assert.match(html, /href="\.\/routes\/stage-1\.gpx"/);
    assert.match(html, /download="TDU-2027-[A-Za-z0-9-]+\.gpx"/);
    assert.match(html, /class="[^"]*btn-gpx/);
    assert.match(html, /⬇️ Download GPX \(Garmin \/ Wahoo\)/);
    assert.equal(ctx.renderStageGpxLink({ title: 'No route' }, 'x'), '');
});
