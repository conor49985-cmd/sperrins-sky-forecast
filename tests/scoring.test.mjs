import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, makeData, kpBlocks, syntheticTle } from './helpers.mjs';
import { LOCATION } from '../scripts/parsers.mjs';

const C = loadCore();
const HOUR = 3600e3;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

// Reference nights: 9 Nov 2026 is new Moon (07:02 GMT); 24 Nov 2026 is full Moon (14:55 GMT).
const NEW_MOON_NIGHT = '2026-11-09';
const FULL_MOON_NIGHT = '2026-11-24';
const MIDSUMMER_NIGHT = '2026-06-21';

test('config location matches the location the data script fetches', () => {
  assert.equal(C.CONFIG.location.lat, LOCATION.lat);
  assert.equal(C.CONFIG.location.lon, LOCATION.lon);
});

test('darkness weight follows the Sun altitude ramp', () => {
  assert.equal(C.darknessWeight(10), 0);
  assert.equal(C.darknessWeight(-6), 0);
  near(C.darknessWeight(-9), 0.125, 1e-9, '-9 deg');
  near(C.darknessWeight(-12), 0.25, 1e-9, '-12 deg');
  near(C.darknessWeight(-15), 0.625, 1e-9, '-15 deg');
  assert.equal(C.darknessWeight(-18), 1);
  assert.equal(C.darknessWeight(-40), 1);
  assert.equal(C.darknessWeight(undefined), 0);
});

test('moon interference: none below horizon, full when high and full', () => {
  assert.equal(C.moonInterference(-1, 1), 0);
  near(C.moonInterference(0.1, 1), 0.4, 0.01, 'just risen');
  near(C.moonInterference(15, 0.5), 0.35, 1e-9, 'half lit at 15 deg');
  assert.equal(C.moonInterference(60, 1), 1);
  assert.equal(C.moonInterference(60, 0), 0);
});

test('visibility factor and Kp chance interpolate between their limits', () => {
  assert.equal(C.visibilityFactor(null), 1);
  assert.equal(C.visibilityFactor(500), 0);
  near(C.visibilityFactor(5500), 0.5, 1e-9, '5.5 km');
  assert.equal(C.visibilityFactor(24000), 1);
  assert.equal(C.kpChance(2), 0);
  near(C.kpChance(4.5), 0.30, 1e-9, 'Kp 4.5');
  near(C.kpChance(5), 0.45, 1e-9, 'Kp 5');
  assert.equal(C.kpChance(9), 1);
});

test('best window picks the strongest run above the threshold', () => {
  const slots = [0.2, 0.8, 0.9, 0.1, 0.7, null, 0.6].map((q, i) => ({ t: i * HOUR, quality: q }));
  const w = C.bestWindow(slots, 0.5);
  assert.equal(w.start, 1 * HOUR);
  assert.equal(w.end, 3 * HOUR);
  assert.equal(w.hours, 2);
  assert.equal(C.bestWindow(slots.map((s) => ({ ...s, quality: 0.3 })), 0.5), null);
});

test('edge case: full cloud all night scores zero with no window', () => {
  const data = makeData({ from: '2026-11-08T00:00:00Z', cloud: () => 100, kp: kpBlocks('2026-11-08T00:00:00Z', 4, 7) });
  const n = C.buildNight(NEW_MOON_NIGHT, data, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(n.scores.star, 0);
  assert.equal(n.scores.aurora, 0, 'aurora cannot be seen through full cloud even at Kp 7');
  assert.equal(n.scores.overall, 0);
  assert.equal(n.scores.window, null);
  assert.match(n.reason, /Overcast \(100% cloud\)/);
  assert.equal(n.rating, 'Not worthwhile');
});

test('clear, moonless winter night scores 100 with a long window', () => {
  const data = makeData({ from: '2026-11-08T00:00:00Z', cloud: () => 0 });
  const n = C.buildNight(NEW_MOON_NIGHT, data, Date.parse('2026-11-09T12:00:00Z'));
  assert.ok(n.frame.darkHours > 10, `dark hours ${n.frame.darkHours}`);
  assert.equal(n.scores.star, 100);
  assert.ok(n.scores.window && n.scores.window.hours >= 10, 'window covers most of the night');
  assert.match(n.reason, /^Clear spell/);
  assert.ok(n.moon.illumination < 0.01);
});

test('edge case: full Moon on a clear night scores poorly', () => {
  const data = makeData({ from: '2026-11-23T00:00:00Z', cloud: () => 0 });
  const n = C.buildNight(FULL_MOON_NIGHT, data, Date.parse('2026-11-24T12:00:00Z'));
  assert.ok(n.moon.illumination > 0.99, `illumination ${n.moon.illumination}`);
  assert.ok(n.scores.star >= 10 && n.scores.star < 35, `star score ${n.scores.star}`);
  assert.equal(n.rating, 'Poor');
  assert.match(n.reason, /Moon/);
});

test('edge case: midsummer short night has no astronomical darkness and a low score', () => {
  const data = makeData({ from: '2026-06-20T00:00:00Z', cloud: () => 0 });
  const n = C.buildNight(MIDSUMMER_NIGHT, data, Date.parse('2026-06-21T12:00:00Z'));
  assert.equal(n.frame.astroDusk, null);
  assert.equal(n.frame.darkHours, 0);
  assert.ok(n.scores.star < 25, `star score ${n.scores.star}`);
  assert.ok(n.slots.every((s) => s.sunAlt > -18), 'Sun never reaches -18 deg');
  assert.match(n.reason, /No full darkness|Moon/);
});

test('aurora: strong Kp on a clear dark night scores high; low Kp scores zero', () => {
  const strong = makeData({ from: '2026-11-08T00:00:00Z', kp: kpBlocks('2026-11-08T00:00:00Z', 4, 7) });
  const s = C.buildNight(NEW_MOON_NIGHT, strong, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(s.scores.aurora, 95);
  assert.equal(s.kpMax, 7);
  assert.match(s.reason, /aurora chance 95 \(Kp 7\)/);
  const quiet = makeData({ from: '2026-11-08T00:00:00Z', kp: kpBlocks('2026-11-08T00:00:00Z', 4, 2) });
  assert.equal(C.buildNight(NEW_MOON_NIGHT, quiet, Date.parse('2026-11-09T12:00:00Z')).scores.aurora, 0);
});

test('aurora: 27-day outlook is used beyond the forecast, at reduced trust', () => {
  const data = makeData({ from: '2026-11-08T00:00:00Z', outlook: { issued: null, days: [{ date: '2026-11-09', kp: 7 }, { date: '2026-11-10', kp: 7 }] } });
  const n = C.buildNight(NEW_MOON_NIGHT, data, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(n.kpSource, 'outlook');
  assert.equal(n.scores.aurora, Math.round(100 * (0.95 * 0.7)));
});

test('missing weather data gives no score rather than an invented one', () => {
  const data = makeData({ from: '2026-11-08T00:00:00Z', hours: 0 });
  const n = C.buildNight(NEW_MOON_NIGHT, data, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(n.scores.star, null);
  assert.equal(n.scores.overall, null);
  assert.equal(n.rating, 'No data');
  assert.match(n.reason, /not yet available/);
});

test('cloud clearing late in the evening moves the best window', () => {
  const clearAt = Date.parse('2026-11-09T23:00:00Z');
  const data = makeData({ from: '2026-11-08T00:00:00Z', cloud: (t) => (t < clearAt ? 100 : 0) });
  const n = C.buildNight(NEW_MOON_NIGHT, data, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(n.scores.window.start, clearAt);
  assert.equal(n.scores.star, 100);
});

test('night in progress: past hours are excluded from the score', () => {
  const now = Date.parse('2026-11-10T02:30:00Z');
  const clearUntil = Date.parse('2026-11-10T02:00:00Z');
  const data = makeData({ from: '2026-11-08T00:00:00Z', cloud: (t) => (t < clearUntil ? 0 : 100) });
  const f = C.buildForecast(data, now);
  assert.equal(f.nights[0].date, NEW_MOON_NIGHT, 'before sunrise, "tonight" is the night that began yesterday');
  assert.ok(f.nights[0].slots.some((s) => s.past));
  assert.equal(f.nights[0].scores.star, 0, 'only the cloudy remaining hours count');
});

test('forecast covers seven consecutive nights', () => {
  const data = makeData({ from: '2026-11-03T00:00:00Z' });
  const f = C.buildForecast(data, Date.parse('2026-11-03T20:00:00Z'));
  assert.equal(f.nights.length, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(f.nights.map((n) => n.date))), ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
  for (const n of f.nights) assert.ok(n.scores.star >= 0 && n.scores.star <= 100);
});

test('changing a weight in CONFIG changes the score', () => {
  const data = makeData({ from: '2026-11-23T00:00:00Z', cloud: () => 0 });
  const now = Date.parse('2026-11-24T12:00:00Z');
  const base = C.buildNight(FULL_MOON_NIGHT, data, now).scores.star;
  const cfg = JSON.parse(JSON.stringify(C.CONFIG));
  cfg.stargazing.moonWeight = 0;
  const noMoon = C.buildNight(FULL_MOON_NIGHT, data, now, cfg).scores.star;
  assert.ok(noMoon > base, `${noMoon} > ${base}`);
  assert.equal(noMoon, 100);
});

/* ---- astronomy checked against published values ---- */
const COOKSTOWN = { lat: 54.6418, lon: -6.7444, timeZone: 'Europe/London' };

test('sunset and sunrise match published Cookstown times (sunrise-sunset.org) within 4 minutes', () => {
  const minOfDay = (t) => { const d = new Date(t); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };
  near(minOfDay(C.nightFrame('2026-12-14', COOKSTOWN).sunset), 16 * 60 + 3, 4, 'earliest sunset 14 Dec, 16:03 GMT');
  near(minOfDay(C.nightFrame('2026-12-28', COOKSTOWN).sunrise), 8 * 60 + 47, 4, 'latest sunrise 29 Dec, 08:47 GMT');
  near(minOfDay(C.nightFrame('2026-06-24', COOKSTOWN).sunset), 21 * 60 + 10, 4, 'latest sunset 24 Jun, 22:10 BST');
});

test('Moon phase matches published new and full Moon times (Nov 2026)', () => {
  const ill = (iso) => C.moonSummary({ sunset: Date.parse(iso), sunrise: Date.parse(iso), astroDusk: null, darkHours: 0 }).illumination;
  assert.ok(ill('2026-11-09T07:02:00Z') < 0.002, 'new Moon 9 Nov 07:02 GMT');
  assert.ok(ill('2026-11-24T14:55:00Z') > 0.998, 'full Moon 24 Nov 14:55 GMT');
  assert.equal(C.phaseName(0.5), 'Full');
  assert.equal(C.phaseName(0.01), 'New');
});

/* ---- ISS ---- */
test('shadow test: ISS is sunlit on the day side and eclipsed behind Earth', () => {
  const d = new Date('2026-11-09T12:00:00Z');
  // Sun direction in November is roughly towards RA 15h (negative x, negative y).
  const s = { x: -0.69, y: -0.66, z: -0.29 };
  const r = 6778;
  assert.equal(C.isSunlit({ x: s.x * r, y: s.y * r, z: s.z * r }, d), true);
  assert.equal(C.isSunlit({ x: -s.x * r, y: -s.y * r, z: -s.z * r }, d), false);
});

test('ISS pass finder returns plausible visible passes', () => {
  const tle = syntheticTle('26313.50000000');
  const t0 = Date.parse('2026-11-09T16:00:00Z'), t1 = t0 + 16 * HOUR;
  const passes = C.issPasses(tle, t0, t1);
  for (const p of passes) {
    assert.ok(p.start >= t0 && p.end <= t1 && p.end >= p.start);
    assert.ok(p.maxEl >= 10 && p.maxEl <= 90);
    assert.ok(p.durationMin >= 1 && p.durationMin <= 12, `duration ${p.durationMin}`);
    assert.match(p.from, /^(N|NE|E|SE|S|SW|W|NW)$/);
  }
  // With no orbital data the finder returns nothing rather than guessing.
  assert.equal(C.issPasses(null, t0, t1).length, 0);
});
