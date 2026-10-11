import { sampleField } from '../sources/weather.js';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(deg) {
    return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// Direction a fire would be pushed: opposite of where the wind comes from.
export function downwind(deg) {
    return compass(deg + 180);
}

// Santa Anas blow offshore: from the north through east-southeast toward the coast.
export function isOffshore(dir) {
    return dir >= 340 || dir <= 120;
}

// Roughly NWS Southern California red-flag criteria (RH ≤ 15% with sustained ≥ 25 mph or gusts ≥ 35),
// plus an "elevated" tier for dry offshore wind below that bar.
export function fireWeatherLevel({ speed, gust, rh, dir }) {
    if (rh <= 15 && (speed >= 25 || gust >= 35)) return 'critical';
    if ((isOffshore(dir) && rh <= 25 && gust >= 20) || (rh <= 15 && gust >= 15)) return 'elevated';
    return 'normal';
}

// Surface approximation of the Hot-Dry-Windy Index: vapor pressure deficit (hPa) × wind (m/s).
// The real index uses the lowest 500 m of the atmosphere; this only has 2 m / 10 m values, and like
// HDW it knows nothing about fuel, so bare desert reads high on hot afternoons.
export function hotDryWindy(tempF, rh, windMph) {
    const tc = ((tempF - 32) * 5) / 9;
    const es = 6.112 * Math.exp((17.67 * tc) / (tc + 243.5));
    const vpd = es * (1 - rh / 100);
    return Math.max(0, vpd) * windMph * 0.44704;
}

export const HDW_STOPS = [
    [40, 'rgba(255, 209, 102, 0)'],
    [100, 'rgba(255, 209, 102, 0.35)'],
    [200, 'rgba(255, 159, 28, 0.5)'],
    [325, 'rgba(255, 59, 31, 0.6)'],
    [500, 'rgba(214, 0, 110, 0.7)'],
];

function withLevel(c) {
    c.level = fireWeatherLevel(c);
    c.hdw = hotDryWindy(c.temp, c.rh, c.speed);
    return c;
}

// Conditions at any location from the grid. Direction comes from interpolated u/v
// (averaging raw degrees breaks across north). Returns null outside the forecast area.
export function conditionsAt(forecast, hour, [lng, lat]) {
    const u = sampleField(forecast, forecast.u, hour, lng, lat);
    const v = sampleField(forecast, forecast.v, hour, lng, lat);
    if (Number.isNaN(u) || Number.isNaN(v)) return null;
    return withLevel({
        time: forecast.times[hour],
        speed: Math.hypot(u, v),
        dir: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360,
        gust: sampleField(forecast, forecast.gust, hour, lng, lat),
        rh: sampleField(forecast, forecast.rh, hour, lng, lat),
        temp: sampleField(forecast, forecast.temp, hour, lng, lat),
    });
}

// Series for a dedicated forecast point (full model resolution, not interpolated).
export function pointSeries(forecast, id) {
    return forecast.points[id].map((c) => withLevel({ ...c }));
}

// Wind at the timeline hour plus the strongest gust in the 24h after it, for a fire's origin.
export function fireWindOutlook(forecast, hour, coords) {
    const now = conditionsAt(forecast, hour, coords);
    if (!now) return null;
    let peak = now;
    for (let h = hour + 1; h < Math.min(hour + 24, forecast.times.length); h++) {
        const c = conditionsAt(forecast, h, coords);
        if (c && c.gust > peak.gust) peak = c;
    }
    return { now, peak };
}

// Contiguous runs of elevated/critical hours.
export function riskWindows(series) {
    const windows = [];
    let current = null;
    series.forEach((s, i) => {
        if (s.level === 'normal') {
            current = null;
            return;
        }
        if (!current) {
            current = { start: i, end: i, level: s.level, maxGust: s.gust, minRh: s.rh, dir: s.dir };
            windows.push(current);
        }
        current.end = i;
        if (s.level === 'critical') current.level = 'critical';
        if (s.gust > current.maxGust) {
            current.maxGust = s.gust;
            current.dir = s.dir;
        }
        current.minRh = Math.min(current.minRh, s.rh);
    });
    return windows;
}
