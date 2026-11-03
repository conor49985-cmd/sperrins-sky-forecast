# Sperrins Sky Forecast

A personal dark-sky forecast for the **OM Dark Sky Park, Davagh Forest, County Tyrone** (54.7203°N, 6.9233°W, the observatory's published position). For each of the next seven nights it shows:
- an observing score from 0 to 100;
- a one-line reason;
- the best viewing window;
- an hourly timeline of cloud and darkness;
- Moon details;
- visible ISS passes;
- the aurora outlook.

## How it works

| Part | What it does |
|---|---|
| `index.html` | The whole app: HTML, CSS and JavaScript, with no build step. It contains the scoring `CONFIG`, the astronomy (SunCalc), the ISS orbit propagation (satellite.js) and the interface. |
| `scripts/fetch-data.mjs` | Fetches every source, normalises it and writes `data/latest.json`, plus raw copies in `data/raw/`. |
| `.github/workflows/refresh.yml` | Runs every 3 hours. It runs the tests, fetches the data, commits it and deploys the site to GitHub Pages. |
| `tests/` | Unit tests using `node --test tests/*.test.mjs` (Node 20+, no dependencies). |

The page loads `data/latest.json` from its own site, not from the APIs directly. There are three reasons:
- the data is refreshed even when nobody has the page open;
- each source's last good data is kept if a fetch fails;
- the browser caches the last loaded data, so the app still opens without a signal at the park.

## Data sources

| Data | Source | Key | Use and limits |
|---|---|---|---|
| Hourly cloud cover (total, low, mid, high) and visibility | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | None | Free for non-commercial use, under 10,000 calls a day. This app makes 8 calls a day. |
| Planetary Kp index, 3-day forecast (3-hour blocks) | [NOAA SWPC](https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json) | None | Public US government data. |
| Kp for nights beyond 3 days (daily maximum) | [NOAA SWPC 27-day outlook](https://services.swpc.noaa.gov/text/27-day-outlook.txt) | None | Lower confidence, so weighted down. |
| Current UK aurora alert level | [AuroraWatch UK](https://aurorawatch.lancs.ac.uk/api-info/), Lancaster University | None | Shown for tonight only. Not part of the score. |
| ISS orbital elements (TLE) | [CelesTrak](https://celestrak.org/NORAD/elements/) | None | CelesTrak asks that the same data is not downloaded more than once every 2 hours. This app fetches it every 3 hours. |
| Sun, Moon and twilight | Calculated in the page with [SunCalc](https://github.com/mourner/suncalc) (BSD-2) | — | No network needed. Checked against published Cookstown sunrise and sunset times, and the November 2026 new and full Moon times. |
| ISS pass prediction | Calculated in the page with [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4, MIT) | — | A pass is listed when the ISS is above 10°, in sunlight, and the Sun is below −6°. |

## How the score works

Each night runs from sunset to sunrise and is divided into hours. Every hour gets a quality from 0 to 1:

```
hour quality = darkness × (1 − cloudWeight × cloud%) × (1 − moonWeight × moon interference) × (1 − visibilityWeight × haze)
```

- **Darkness** depends on the Sun's altitude. It is 0 in civil twilight, 0.25 at −12° and 1 below −18° (astronomical darkness).
- **Moon interference** is the fraction illuminated multiplied by a height effect. A Moon just above the horizon has 40% of its full effect, rising to 100% at 30°. A Moon below the horizon has no effect.
- **Haze** is 1 when visibility is 1 km or less, and 0 when it is 10 km or more.

The night is then scored as follows:
- **Stargazing score:** square each hour's quality, add the results up, and divide by 4. Cap the result at 100. Four perfect hours earn 100. Squaring means a few excellent hours count for more than many poor ones, so a clear night under a full Moon scores about 20 ("Poor").
- **Aurora score:** the best single hour's chance. The Kp index gives a base chance (Kp 4 → 15%, Kp 5 → 45%, Kp 6 → 75%, Kp 7 → 95%), which is then reduced by cloud, a bright Moon (weight 0.4) and twilight. Nights covered only by the 27-day outlook are trusted at 70%.
- **Observing score:** the higher of the two.
- **Best window:** the run of consecutive hours rated 0.5 or more with the greatest total.

## Changing the weights

Open `index.html` and find `const CONFIG = {` near the top of the `<script id="core">` block. All weights and thresholds are there, each with a comment. For example:
- set `stargazing.moonWeight` to `0.5` to make the Moon matter less;
- set `stargazing.targetHours` to `6` to require a longer clear spell for 100;
- edit `aurora.kpChance` to change how Kp maps to aurora chance.

Run `node --test tests/*.test.mjs` afterwards. Some tests check the default behaviour, so update their expected values if you change the defaults deliberately. Commit and push, and the workflow redeploys the site.

## Known limitations

- Cloud is the forecast for a single point. Aurora watching depends on the northern horizon, which may differ.
- ISS times more than about three days ahead can shift by minutes, because of atmospheric drag and orbit-raising burns.
- GitHub may pause scheduled workflows in repositories with no activity for 60 days. The data commits normally count as activity.
- Light pollution and transparency beyond visibility (for example, high thin haze) are not modelled.
