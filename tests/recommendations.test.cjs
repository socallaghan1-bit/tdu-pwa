const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));

function loadFunction(context, name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `Missing ${name}`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
}

function setup(data = events) {
    const context = vm.createContext({ allEvents: data, formatDate: (date) => date });
    for (const name of ['PARTICIPATION_TAGS', 'SPECTATOR_RACE_TAGS']) {
        const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
        assert.ok(match, `Missing ${name}`);
        vm.runInContext(match[0].replace('const ', 'var '), context);
    }
    for (const name of [
        'getEventType', 'getEventRatingLabel', 'getEventRatingVibes', 'getEventStatus', 'getEventArea',
        'formatOptionLabel', 'getRawEventTags', 'isParticipationEvent', 'getEventTags', 'isRideEvent',
        'isWatchEvent', 'isSocialEvent', 'matchRecommendationOption', 'getRecommendationSummary',
        'getRecommendationEmptyMessage', 'buildRecommendationReason', 'getRecommendationResult'
    ]) loadFunction(context, name);
    return context;
}

const WATCH_OPTIONS = ['climbing', 'coastal', 'city', 'any-stage'];

test('watching racing never recommends kids or community participation rides', () => {
    const ctx = setup();
    const familyRide = events.find((event) => event.id === '2027-health-partners-family-ride');
    // Its description mentions the "stage circuit", which used to tag it as a race.
    assert.ok(familyRide && /stage/i.test(familyRide.description));
    assert.equal(ctx.isWatchEvent(familyRide), false);

    WATCH_OPTIONS.forEach((option) => {
        const { matches } = ctx.getRecommendationResult('watch', option);
        matches.forEach(({ event }) => {
            assert.equal(ctx.isParticipationEvent(event), false, `${option} returned ${event.id}`);
            assert.ok(!/community ride|participation|family event/i.test(`${event.category} ${event.type}`), `${option} returned ${event.id}`);
        });
    });
});

test('participation rides stay excluded from watch results even if mis-tagged as races', () => {
    const kidsRide = {
        id: 'kids-crit', title: 'Kids Stage Sprint', category: 'Community Rides', type: 'Participation Ride',
        date: '2027-01-18', tags: ['race', 'pro-racing', 'sprint', 'kids'], featured: true
    };
    const ctx = setup([kidsRide, ...events]);
    assert.ok(!ctx.getEventTags(kidsRide).some((tag) => ['race', 'pro-racing', 'sprint'].includes(tag)));
    WATCH_OPTIONS.forEach((option) => {
        assert.ok(!ctx.getRecommendationResult('watch', option).matches.some(({ event }) => event.id === 'kids-crit'));
    });
    assert.ok(ctx.isRideEvent(kidsRide));
});

test('spectator pro races with a gravel sector are watch picks, not ride picks', () => {
    const ctx = setup();
    const roadRace = events.find((event) => event.id === '2027-oceania-rr');
    assert.ok(ctx.isWatchEvent(roadRace));
    assert.equal(ctx.isRideEvent(roadRace), false);
    assert.ok(!ctx.getRecommendationResult('ride', 'gravel').matches.some(({ event }) => event.id === '2027-oceania-rr'));
});
