// Loads the core script and libraries out of index.html into a sandbox, so the exact code the page runs is tested.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadCore() {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ctx = vm.createContext({ console });
  for (const id of ['lib-suncalc', 'lib-satellite', 'core']) {
    const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
    if (!m) throw new Error(`script #${id} not found in index.html`);
    vm.runInContext(m[1], ctx, { filename: `index.html#${id}` });
  }
  return ctx.SkyCore;
}

const HOUR = 3600e3;

/** Synthetic data in the same shape as data/latest.json, for unit tests only. */
export function makeData({ from, hours = 24 * 10, cloud = () => 0, visibility = () => 30000, kp = null, outlook = null, tle = null }) {
  const t0 = Math.floor(Date.parse(from) / HOUR) * HOUR;
  const time = [];
  for (let i = 0; i < hours; i++) time.push(t0 + i * HOUR);
  const cl = time.map((t) => cloud(t));
  const src = (data) => ({ label: 'test', url: 'test', ok: true, fetchedAt: from, lastSuccessAt: from, error: null, data });
  return {
    schema: 1,
    generatedAt: from,
    sources: {
      weather: src({ time, cloud: cl, cloudLow: cl, cloudMid: cl.map(() => 0), cloudHigh: cl.map(() => 0), visibility: time.map((t) => visibility(t)) }),
      kp: src(kp),
      kpOutlook: src(outlook),
      aurorawatch: src(null),
      iss: src(tle),
    },
  };
}

/** Kp blocks (3-hourly) with a constant value over a span, NOAA-forecast style. */
export function kpBlocks(fromIso, days, value, kind = 'predicted') {
  const out = [];
  const t0 = Date.parse(fromIso);
  for (let i = 0; i < days * 8; i++) out.push({ t: new Date(t0 + i * 3 * HOUR).toISOString(), kp: value, kind });
  return out;
}

function checksum(line68) {
  let s = 0;
  for (const ch of line68) { if (ch >= '0' && ch <= '9') s += +ch; else if (ch === '-') s += 1; }
  return line68 + (s % 10);
}

/** Synthetic ISS-like TLE (elements from the well-known 2008 ISS example, epoch moved). Test fixture only. */
export function syntheticTle(epochYYDDD = '26313.50000000') {
  const l1 = `1 25544U 98067A   ${epochYYDDD} -.00002182  00000-0 -11606-4 0  292`;
  const l2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.7212539156353';
  return { name: 'ISS (TEST)', line1: checksum(l1), line2: checksum(l2) };
}
