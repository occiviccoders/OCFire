// Facts about the ground and recent weather at a heat spot, used by assess() in earlyDetection.js.
// Shared by the app and workers/collector, so it only uses fetch and takes the site origin as a parameter.

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const CHUNK = 50;
const THUNDER_CODE = 95; // WMO weather codes 95–99 are thunderstorms
const RAIN_DAY_IN = 0.1;
export const DRY_DAYS_MAX = 14;

// NLCD 2021 classes grouped by how they bear on "is this a wildfire?"
export function landKind(code) {
    if (code == null) return null;
    if ([41, 42, 43, 51, 52, 71, 72, 90, 95].includes(code)) return 'wildland';
    if (code === 81 || code === 82) return 'farm';
    if (code >= 21 && code <= 24) return 'developed';
    if (code === 31) return 'barren';
    if (code === 11 || code === 12) return 'water';
    return null;
}

const LAND_LABEL = {
    41: 'forest', 42: 'forest', 43: 'forest', 51: 'shrubland', 52: 'shrubland', 71: 'grassland', 72: 'grassland',
    90: 'wetland', 95: 'wetland', 81: 'pasture', 82: 'cropland', 21: 'developed land', 22: 'developed land',
    23: 'developed land', 24: 'developed land', 31: 'bare ground (mines, quarries, rock)', 11: 'water', 12: 'snow or ice',
};
export const landLabel = (code) => LAND_LABEL[code] || null;

// daily: Open-Meteo daily block with precipitation_sum (inches) and weather_code, oldest first, today last.
export function weatherFacts(daily) {
    if (!daily?.time?.length) return null;
    const rain = daily.precipitation_sum.map((v) => v || 0);
    const codes = daily.weather_code;
    const n = rain.length;
    const last3 = (arr) => arr.slice(Math.max(0, n - 4)); // today plus the 3 days before
    let dryDays = 0;
    for (let i = n - 1; i >= 0 && rain[i] < RAIN_DAY_IN; i--) dryDays++;
    return {
        rain3: Math.round(last3(rain).reduce((a, v) => a + v, 0) * 100) / 100,
        thunder3: last3(codes).some((c) => c >= THUNDER_CODE),
        dryDays: Math.min(dryDays, DRY_DAYS_MAX),
    };
}

async function fetchWeatherFacts(points) {
    const out = [];
    for (let i = 0; i < points.length; i += CHUNK) {
        const chunk = points.slice(i, i + CHUNK);
        const params = new URLSearchParams({
            latitude: chunk.map((p) => p[1].toFixed(3)).join(','),
            longitude: chunk.map((p) => p[0].toFixed(3)).join(','),
            daily: 'precipitation_sum,weather_code',
            past_days: String(DRY_DAYS_MAX),
            forecast_days: '1',
            precipitation_unit: 'inch',
            timezone: 'America/Los_Angeles',
        });
        const res = await fetch(`${OPEN_METEO}?${params}`);
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const data = await res.json();
        for (const loc of Array.isArray(data) ? data : [data]) out.push(weatherFacts(loc.daily));
    }
    return out;
}

export async function fetchLandCover([lng, lat], site = '') {
    const res = await fetch(`${site}/api/landcover/${lat.toFixed(4)},${lng.toFixed(4)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0]?.properties?.PALETTE_INDEX ?? null;
}

// points: [lng, lat][]; returns [{ land, rain3, thunder3, dryDays }] in the same order. Missing pieces are null.
export async function fetchSiteFacts(points, { site = '', land = true } = {}) {
    if (!points.length) return [];
    const [weather, lands] = await Promise.all([
        fetchWeatherFacts(points).catch(() => points.map(() => null)),
        land ? Promise.all(points.map((p) => fetchLandCover(p, site).catch(() => null))) : points.map(() => null),
    ]);
    return points.map((_, i) => ({ land: lands[i], ...(weather[i] || {}) }));
}
