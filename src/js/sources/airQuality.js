import { FORECAST_POINTS, WIND_FORECAST_HOURS } from '../config.js';
import { fetchJSON } from '../util.js';

// Open-Meteo air-quality forecast (CAMS model, includes wildfire smoke), US AQI from PM2.5/ozone/etc.
const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const CACHE_MS = 60 * 60 * 1000;

// EPA AQI categories with plain-language guidance for smoke.
export const AQI_LEVELS = [
    { max: 50, label: 'Good', color: '#3ddc84', advice: 'Air is fine. No precautions needed.' },
    { max: 100, label: 'Moderate', color: '#ffd166', advice: 'Fine for most people. If you’re unusually sensitive to smoke, take it easier outdoors.' },
    { max: 150, label: 'Unhealthy for sensitive groups', color: '#ff9f1c', advice: 'Kids, older adults, and people with asthma or heart conditions should limit time outside. Close windows.' },
    { max: 200, label: 'Unhealthy', color: '#ff3b1f', advice: 'Everyone should cut back outdoors. Keep windows shut, run AC on recirculate or a HEPA purifier, and wear an N95 outside.' },
    { max: 300, label: 'Very unhealthy', color: '#b5179e', advice: 'Stay indoors with filtered air. Wear an N95 if you must go out; cloth and surgical masks don’t stop smoke.' },
    { max: Infinity, label: 'Hazardous', color: '#7a0b2e', advice: 'Avoid all outdoor activity. Consider going somewhere with cleaner air if you can’t filter indoor air.' },
];

export function aqiLevel(aqi) {
    return AQI_LEVELS.find((l) => aqi <= l.max);
}

async function fetchSeries(points) {
    const params = new URLSearchParams({
        latitude: points.map((p) => p[1]).join(','),
        longitude: points.map((p) => p[0]).join(','),
        hourly: 'us_aqi,pm2_5',
        forecast_hours: String(WIND_FORECAST_HOURS + 3),
        timezone: 'GMT',
    });
    const data = await fetchJSON(`${ENDPOINT}?${params}`);
    return (Array.isArray(data) ? data : [data]).map((d) =>
        d.hourly.time.map((t, i) => ({ time: Date.parse(`${t}Z`), aqi: d.hourly.us_aqi[i], pm25: d.hourly.pm2_5[i] })),
    );
}

let cache = { at: 0, data: null };

// { [pointId]: [{ time, aqi, pm25 }] } for FORECAST_POINTS.
export async function fetchPointAirQuality() {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
    const series = await fetchSeries(FORECAST_POINTS.map((p) => p.coords));
    cache = { at: Date.now(), data: Object.fromEntries(FORECAST_POINTS.map((p, i) => [p.id, series[i]])) };
    return cache.data;
}

export async function fetchAirQualityAt(coords) {
    return (await fetchSeries([coords]))[0];
}

// Reading at a given timestamp plus the worst hour in the following 24h.
export function airOutlook(series, time) {
    if (!series?.length) return null;
    const i = Math.max(0, series.findIndex((s) => s.time >= time));
    const now = series[i];
    if (now?.aqi == null) return null;
    const peak = series.slice(i + 1, i + 25).reduce((best, s) => (s.aqi != null && s.aqi > best.aqi ? s : best), now);
    return { now, peak };
}
