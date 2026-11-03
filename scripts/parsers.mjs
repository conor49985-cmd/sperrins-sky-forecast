// Parsers that turn each source's raw response into the normalised shape stored in data/latest.json.
// Each parser throws an Error with a clear message if the response is not in the expected format.

export const LOCATION = { name: 'OM Dark Sky Park, Davagh Forest', lat: 54.7203, lon: -6.9233 };

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function toIsoUtc(tag) {
  // NOAA time tags: "2026-11-03 00:00:00" or "2026-11-03T00:00:00" (UTC, no zone suffix)
  let s = String(tag).trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Unreadable time tag: ${tag}`);
  return d.toISOString();
}

/** Open-Meteo forecast JSON (timeformat=unixtime) -> hourly arrays. */
export function parseOpenMeteo(text) {
  const j = JSON.parse(text);
  const h = j && j.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.cloud_cover)) {
    throw new Error('Open-Meteo response has no hourly.time / hourly.cloud_cover');
  }
  const n = h.time.length;
  const col = (k) => (Array.isArray(h[k]) && h[k].length === n ? h[k] : new Array(n).fill(null));
  return {
    model: j.generationtime_ms !== undefined ? 'best_match' : 'unknown',
    elevation: j.elevation ?? null,
    time: h.time.map((t) => t * 1000), // epoch milliseconds, UTC
    cloud: col('cloud_cover'),
    cloudLow: col('cloud_cover_low'),
    cloudMid: col('cloud_cover_mid'),
    cloudHigh: col('cloud_cover_high'),
    visibility: col('visibility'),
  };
}

/** NOAA SWPC planetary K-index forecast JSON -> [{t, kp, kind}] in 3-hour blocks. */
export function parseKpForecast(text) {
  const j = JSON.parse(text);
  if (!Array.isArray(j) || j.length === 0) throw new Error('Kp forecast is not a non-empty array');
  let rows;
  if (Array.isArray(j[0])) {
    // Legacy table format: first row is the header.
    const header = j[0].map((x) => String(x).toLowerCase());
    const iT = header.indexOf('time_tag');
    const iK = header.indexOf('kp');
    const iO = header.indexOf('observed');
    if (iT < 0 || iK < 0) throw new Error('Kp forecast header lacks time_tag/kp');
    rows = j.slice(1).map((r) => ({ time_tag: r[iT], kp: r[iK], observed: iO >= 0 ? r[iO] : null }));
  } else {
    rows = j; // Object format: [{time_tag, kp, observed, noaa_scale}]
  }
  const out = [];
  for (const r of rows) {
    const kp = Number(r.kp);
    if (r.time_tag == null || !Number.isFinite(kp)) continue;
    out.push({ t: toIsoUtc(r.time_tag), kp, kind: r.observed ? String(r.observed) : 'unknown' });
  }
  if (!out.length) throw new Error('Kp forecast contained no usable rows');
  return out;
}

/** NOAA SWPC 27-day outlook text -> {issued, days:[{date, flux, ap, kp}]} */
export function parseKpOutlook(text) {
  const issuedM = text.match(/:Issued:\s*(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2})(\d{2})\s*UTC/);
  const issued = issuedM
    ? `${issuedM[1]}-${pad(MONTHS[issuedM[2]])}-${pad(issuedM[3])}T${issuedM[4]}:${issuedM[5]}:00Z`
    : null;
  const days = [];
  const re = /^\s*(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s*$/gm;
  let m;
  while ((m = re.exec(text))) {
    if (!MONTHS[m[2]]) continue;
    days.push({ date: `${m[1]}-${pad(MONTHS[m[2]])}-${pad(m[3])}`, flux: +m[4], ap: +m[5], kp: +m[6] });
  }
  if (!days.length) throw new Error('27-day outlook contained no data rows');
  return { issued, days };
}

/** AuroraWatch UK current-status XML (API 0.2) -> {status, updated} */
export function parseAuroraWatch(text) {
  const s = text.match(/status_id="([a-z]+)"/i);
  if (!s) throw new Error('AuroraWatch XML has no status_id');
  const u = text.match(/<datetime>([^<]+)<\/datetime>/);
  let updated = null;
  if (u) {
    const iso = u[1].trim().replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
    const d = new Date(iso);
    updated = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return { status: s[1].toLowerCase(), updated };
}

function tleChecksumOk(line) {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += +ch;
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === +line[68];
}

/** CelesTrak TLE text -> {name, line1, line2, epoch} */
export function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const i1 = lines.findIndex((l) => l.startsWith('1 '));
  if (i1 < 0 || !lines[i1 + 1] || !lines[i1 + 1].startsWith('2 ')) throw new Error('No TLE line pair found');
  const line1 = lines[i1];
  const line2 = lines[i1 + 1];
  if (line1.length < 69 || line2.length < 69) throw new Error('TLE lines are too short');
  if (!tleChecksumOk(line1) || !tleChecksumOk(line2)) throw new Error('TLE checksum failed');
  const name = i1 > 0 ? lines[i1 - 1].trim() : 'ISS';
  const yy = +line1.slice(18, 20);
  const doy = parseFloat(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const epoch = new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000).toISOString();
  return { name, line1, line2, epoch };
}
