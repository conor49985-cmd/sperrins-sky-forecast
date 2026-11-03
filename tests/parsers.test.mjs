import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenMeteo, parseKpForecast, parseKpOutlook, parseAuroraWatch, parseTle } from '../scripts/parsers.mjs';
import { syntheticTle } from './helpers.mjs';

test('Open-Meteo: unixtime hourly arrays become millisecond times', () => {
  const j = { elevation: 260, generationtime_ms: 1, hourly: { time: [1762200000, 1762203600], cloud_cover: [10, 90], cloud_cover_low: [0, 80], cloud_cover_mid: [5, 10], cloud_cover_high: [10, 0], visibility: [24140, 800] } };
  const d = parseOpenMeteo(JSON.stringify(j));
  assert.deepEqual(d.time, [1762200000000, 1762203600000]);
  assert.deepEqual(d.cloud, [10, 90]);
  assert.deepEqual(d.visibility, [24140, 800]);
  assert.throws(() => parseOpenMeteo('{"error":true,"reason":"bad"}'), /no hourly/);
});

test('Open-Meteo: a missing variable becomes nulls, not zeros', () => {
  const d = parseOpenMeteo(JSON.stringify({ hourly: { time: [1, 2], cloud_cover: [1, 2] } }));
  assert.deepEqual(d.visibility, [null, null]);
});

test('NOAA Kp forecast: legacy table format', () => {
  const t = JSON.stringify([
    ['time_tag', 'kp', 'observed', 'noaa_scale'],
    ['2026-11-03 00:00:00', '2.33', 'observed', null],
    ['2026-11-03 03:00:00', '5.00', 'predicted', 'G1'],
  ]);
  assert.deepEqual(parseKpForecast(t), [
    { t: '2026-11-03T00:00:00.000Z', kp: 2.33, kind: 'observed' },
    { t: '2026-11-03T03:00:00.000Z', kp: 5, kind: 'predicted' },
  ]);
});

test('NOAA Kp forecast: object format', () => {
  const t = JSON.stringify([{ time_tag: '2026-11-03T06:00:00', kp: 3.67, observed: 'estimated', noaa_scale: null }]);
  assert.deepEqual(parseKpForecast(t), [{ t: '2026-11-03T06:00:00.000Z', kp: 3.67, kind: 'estimated' }]);
  assert.throws(() => parseKpForecast('[]'), /non-empty/);
});

test('NOAA 27-day outlook text', () => {
  const t = `:Product: 27-day Space Weather Outlook Table 27DO.txt
:Issued: 2026 Nov 02 0118 UTC
# Prepared by the US Dept. of Commerce, NOAA, Space Weather Prediction Center
#   UTC      Radio Flux   Planetary   Largest
#  Date       10.7 cm      A Index    Kp Index
2026 Nov 02     145          12          4
2026 Nov 03     140           8          3
`;
  const d = parseKpOutlook(t);
  assert.equal(d.issued, '2026-11-02T01:18:00Z');
  assert.deepEqual(d.days[0], { date: '2026-11-02', flux: 145, ap: 12, kp: 4 });
  assert.equal(d.days.length, 2);
  assert.throws(() => parseKpOutlook('nothing here'), /no data rows/);
});

test('AuroraWatch UK status XML', () => {
  const x = `<?xml version="1.0" encoding="UTF-8"?>
<current_status api_version="0.2.5"><updated><datetime>2026-11-03T20:39:04+0000</datetime></updated>
<site_status project_id="project:AWN" site_id="site:AWN:SUM" status_id="amber"/></current_status>`;
  assert.deepEqual(parseAuroraWatch(x), { status: 'amber', updated: '2026-11-03T20:39:04.000Z' });
  assert.throws(() => parseAuroraWatch('<html></html>'), /status_id/);
});

test('CelesTrak TLE with checksum validation and epoch', () => {
  const t = syntheticTle('26307.25000000');
  const d = parseTle(`${t.name}\r\n${t.line1}\r\n${t.line2}\r\n`);
  assert.equal(d.line1, t.line1);
  assert.equal(d.epoch, '2026-11-03T06:00:00.000Z');
  const broken = t.line1.slice(0, 68) + ((+t.line1[68] + 1) % 10);
  assert.throws(() => parseTle(`${broken}\n${t.line2}`), /checksum/);
  assert.throws(() => parseTle('No GP data found'), /No TLE/);
});
