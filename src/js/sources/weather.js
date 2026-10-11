import { FORECAST_POINTS, WIND_FORECAST_HOURS, WIND_GRID, WIND_MASK, WIND_REFRESH_MS } from '../config.js';
import { pointInGeometry } from '../geo.js';
import { fetchJSON } from '../util.js';

// Open-Meteo hourly forecast (best-match model: HRRR/NAM/GFS blend over CONUS), multi-location requests.
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const VARS = {
    speed: 'wind_speed_10m',
    dir: 'wind_direction_10m',
    gust: 'wind_gusts_10m',
    rh: 'relative_humidity_2m',
    temp: 'temperature_2m',
};
const CHUNK = 130;
const CACHE_KEY = 'ocfire.wind.v3';
const CACHE_MAX_AGE_MS = WIND_REFRESH_MS;
// Fetch a few hours past the visible window so a cached grid still covers 72h later on.
const FETCH_HOURS = WIND_FORECAST_HOURS + 4;

const MASK = { type: 'Polygon', coordinates: [WIND_MASK] };

export function buildGrid({ bbox, step } = WIND_GRID) {
    const [w, s, e, n] = bbox;
    const cols = Math.round((e - w) / step) + 1;
    const rows = Math.round((n - s) / step) + 1;
    const points = [];
    const active = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const p = [+(w + c * step).toFixed(3), +(s + r * step).toFixed(3)];
            if (pointInGeometry(p, MASK)) active.push(points.length);
            points.push(p);
        }
    }
    return { west: w, south: s, step, cols, rows, points, active };
}

async function fetchChunk(points) {
    const params = new URLSearchParams({
        latitude: points.map((p) => p[1]).join(','),
        longitude: points.map((p) => p[0]).join(','),
        hourly: Object.values(VARS).join(','),
        wind_speed_unit: 'mph',
        temperature_unit: 'fahrenheit',
        forecast_hours: String(FETCH_HOURS),
        timezone: 'GMT',
    });
    const data = await fetchJSON(`${ENDPOINT}?${params}`);
    return Array.isArray(data) ? data : [data];
}

function readCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (raw && Date.now() - raw.fetchedAt < CACHE_MAX_AGE_MS) return raw;
    } catch {
        // corrupt or unavailable storage; refetch
    }
    return null;
}

function writeCache(raw) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
    } catch {
        // quota exceeded; caching is best-effort
    }
}

const round = (v) => (v == null ? null : Math.round(v * 10) / 10);

function extract(response) {
    return Object.fromEntries(Object.entries(VARS).map(([key, apiName]) => [key, response.hourly[apiName].map(round)]));
}

async function fetchRaw() {
    const grid = buildGrid();
    // Forecast points ride along in the first request.
    const requested = [...FORECAST_POINTS.map((p) => p.coords), ...grid.active.map((i) => grid.points[i])];
    const chunks = [];
    for (let i = 0; i < requested.length; i += CHUNK) chunks.push(requested.slice(i, i + CHUNK));
    const responses = (await Promise.all(chunks.map(fetchChunk))).flat();

    const pointResponses = responses.slice(0, FORECAST_POINTS.length);
    const gridValues = responses.slice(FORECAST_POINTS.length).map(extract);
    return {
        fetchedAt: Date.now(),
        grid: { west: grid.west, south: grid.south, step: grid.step, cols: grid.cols, rows: grid.rows },
        active: grid.active,
        times: responses[0].hourly.time.map((t) => Date.parse(`${t}Z`)),
        // values[var][k][hour] for the k-th active grid point
        values: Object.fromEntries(Object.keys(VARS).map((key) => [key, gridValues.map((v) => v[key])])),
        points: Object.fromEntries(FORECAST_POINTS.map((p, k) => [p.id, extract(pointResponses[k])])),
    };
}

function windComponents(speed, dir) {
    // Meteorological direction is where wind comes FROM; u/v point where it's going.
    const rad = (dir * Math.PI) / 180;
    return [-speed * Math.sin(rad), -speed * Math.cos(rad)];
}

// Reshape to [hour][gridIndex] typed arrays (NaN outside the mask) starting at the current hour.
function toForecast(raw) {
    const nowHour = Math.floor(Date.now() / 3600000) * 3600000;
    const start = Math.max(0, raw.times.findIndex((t) => t >= nowHour));
    const hours = Math.min(WIND_FORECAST_HOURS, raw.times.length - start);
    const size = raw.grid.cols * raw.grid.rows;

    const field = (key) =>
        Array.from({ length: hours }, (_, h) => {
            const arr = new Float32Array(size).fill(NaN);
            raw.active.forEach((gridIndex, k) => {
                arr[gridIndex] = raw.values[key][k][start + h] ?? NaN;
            });
            return arr;
        });

    const speed = field('speed');
    const dir = field('dir');
    const u = [];
    const v = [];
    for (let h = 0; h < hours; h++) {
        const uh = new Float32Array(size);
        const vh = new Float32Array(size);
        for (let i = 0; i < size; i++) [uh[i], vh[i]] = windComponents(speed[h][i], dir[h][i]);
        u.push(uh);
        v.push(vh);
    }

    const times = raw.times.slice(start, start + hours);
    const points = Object.fromEntries(
        Object.entries(raw.points).map(([id, p]) => [
            id,
            times.map((time, h) => ({
                time,
                speed: p.speed[start + h],
                dir: p.dir[start + h],
                gust: p.gust[start + h],
                rh: p.rh[start + h],
                temp: p.temp[start + h],
            })),
        ]),
    );

    return {
        ...raw.grid,
        fetchedAt: raw.fetchedAt,
        pointCount: raw.active.length,
        times,
        speed,
        dir,
        gust: field('gust'),
        rh: field('rh'),
        temp: field('temp'),
        u,
        v,
        points,
    };
}

export async function fetchWindForecast({ force = false } = {}) {
    let raw = force ? null : readCache();
    if (!raw) {
        raw = await fetchRaw();
        writeCache(raw);
    }
    return toForecast(raw);
}

// Bilinear sample of any [hour][gridIndex] field at a lng/lat. NaN outside the grid or mask.
export function sampleField(forecast, field, hour, lng, lat) {
    const fx = (lng - forecast.west) / forecast.step;
    const fy = (lat - forecast.south) / forecast.step;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    if (c0 < 0 || r0 < 0 || c0 >= forecast.cols - 1 || r0 >= forecast.rows - 1) return NaN;
    const tx = fx - c0;
    const ty = fy - r0;
    const data = field[hour];
    const i = r0 * forecast.cols + c0;
    const a = data[i];
    const b = data[i + 1];
    const c = data[i + forecast.cols];
    const d = data[i + forecast.cols + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
