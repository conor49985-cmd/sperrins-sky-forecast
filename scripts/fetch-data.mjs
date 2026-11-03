// Fetches every data source, normalises it and writes data/latest.json (plus raw copies in data/raw/).
// Run by the GitHub Action every 3 hours. If a source fails, its last good data is kept and marked stale.
// Usage: node scripts/fetch-data.mjs   (Node 20+, no dependencies)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LOCATION, parseOpenMeteo, parseKpForecast, parseKpOutlook, parseAuroraWatch, parseTle,
} from './parsers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'latest.json');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const UA = 'SperrinsSkyForecast/1.0 (personal dark-sky forecast; GitHub Actions)';

export const SOURCES = {
  weather: {
    label: 'Open-Meteo forecast',
    url: 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}`
      + '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility'
      + '&timeformat=unixtime&timezone=GMT&past_days=1&forecast_days=9',
    parse: parseOpenMeteo,
    raw: 'open-meteo.json',
  },
  kp: {
    label: 'NOAA SWPC planetary K-index forecast',
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
    parse: parseKpForecast,
    raw: 'noaa-kp-forecast.json',
  },
  kpOutlook: {
    label: 'NOAA SWPC 27-day outlook',
    url: 'https://services.swpc.noaa.gov/text/27-day-outlook.txt',
    parse: parseKpOutlook,
    raw: 'noaa-27-day-outlook.txt',
  },
  aurorawatch: {
    label: 'AuroraWatch UK status',
    url: 'https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml',
    parse: parseAuroraWatch,
    raw: 'aurorawatch.xml',
  },
  iss: {
    label: 'CelesTrak ISS orbital elements',
    url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE',
    parse: parseTle,
    raw: 'celestrak-iss.tle',
  },
};

async function fetchText(url, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function main() {
  let previous = null;
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  await mkdir(RAW_DIR, { recursive: true });

  const now = new Date().toISOString();
  const sources = {};
  let okCount = 0;
  for (const [key, src] of Object.entries(SOURCES)) {
    const prev = previous?.sources?.[key];
    try {
      const text = await fetchText(src.url);
      const data = src.parse(text);
      await writeFile(path.join(RAW_DIR, src.raw), text);
      sources[key] = { label: src.label, url: src.url, ok: true, fetchedAt: now, lastSuccessAt: now, error: null, data };
      okCount++;
      console.log(`OK    ${key}`);
    } catch (e) {
      const msg = e?.message || String(e);
      console.log(`FAIL  ${key}: ${msg}`);
      sources[key] = {
        label: src.label, url: src.url, ok: false, fetchedAt: now,
        lastSuccessAt: prev?.lastSuccessAt ?? null, error: msg, data: prev?.data ?? null,
      };
    }
  }
  const out = { schema: 1, generatedAt: now, location: LOCATION, sources };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT} (${okCount}/${Object.keys(SOURCES).length} sources fresh)`);
  if (okCount === 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
