import { CA_BBOX } from '../config.js';
import { cached, featureCollection } from '../util.js';

// NASA FIRMS near-real-time satellite thermal detections, last 24h.
const SENSORS = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT', 'GOES_NRT'];

export const hotspotsEnabled = __FIRMS_ENABLED__;

function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (!lines[0]?.startsWith('latitude')) throw new Error(`FIRMS: ${lines[0] || 'empty response'}`);
    const headers = lines[0].split(',');
    return lines.slice(1).map((line) => {
        const values = line.split(',');
        return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    });
}

function normalizeConfidence(raw) {
    if (raw === 'h' || raw === 'high') return 'high';
    if (raw === 'l' || raw === 'low') return 'low';
    if (raw === 'n' || raw === 'nominal') return 'nominal';
    const n = Number(raw);
    if (Number.isNaN(n)) return 'nominal';
    return n >= 80 ? 'high' : n < 30 ? 'low' : 'nominal';
}

// FIRMS day ranges are UTC calendar days, so "1" empties out at 00:00 UTC (5 PM in California).
// Ask for two and keep the last 24 hours.
const WINDOW_MS = 24 * 3600000;

// GOES fire mask codes (FDC): 10/30 processed, 11/31 saturated, 13/33 high probability, 15/35 low.
function goesConfidence(raw) {
    const code = Math.round(Number(raw)) % 20;
    if ([10, 11, 13].includes(code)) return 'high';
    return code === 15 ? 'low' : 'nominal';
}

export function parseFirmsRow(r) {
    const t = r.acq_time.padStart(4, '0');
    const goes = /^G\d+$/.test(r.satellite);
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] },
        properties: {
            frp: Number(r.frp) || 0,
            confidence: goes ? goesConfidence(r.confidence) : normalizeConfidence(r.confidence),
            instrument: goes ? 'ABI' : r.instrument,
            satellite: goes ? `GOES-${r.satellite.slice(1)}` : r.satellite,
            daynight: r.daynight,
            acquired: `${r.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`,
            goes,
        },
    };
}

async function fetchSensor(sensor) {
    const res = await fetch(`/api/firms/${sensor}/${CA_BBOX.join(',')}/2`);
    if (!res.ok) throw new Error(`FIRMS ${sensor}: ${res.status}`);
    // GOES_NRT lists each fire twice: detection rows (G18) and fire-power rows (G18FRP). Keep the detections.
    return parseCSV(await res.text()).filter((r) => !r.satellite.endsWith('FRP')).map(parseFirmsRow);
}

export const fetchHotspots = cached(loadHotspots, 2 * 60 * 1000);

async function loadHotspots() {
    if (!hotspotsEnabled) return featureCollection([]);
    const results = await Promise.allSettled(SENSORS.map(fetchSensor));
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason;
    const since = Date.now() - WINDOW_MS;
    const features = ok.flatMap((r) => r.value).filter((f) => f.properties.confidence !== 'low' && Date.parse(f.properties.acquired) >= since);
    return featureCollection(features);
}

// Detections from the five days before today, used to spot persistent heat (refinery flares,
// power plants, landfills) that shows up every day and isn't a new fire.
const HISTORY_SENSORS = ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT'];
const HISTORY_CACHE_MS = 3 * 60 * 60 * 1000;
let historyCache = { at: 0, data: null };

export async function fetchHotspotHistory() {
    if (!hotspotsEnabled) return [];
    if (historyCache.data && Date.now() - historyCache.at < HISTORY_CACHE_MS) return historyCache.data;
    const start = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const results = await Promise.allSettled(
        HISTORY_SENSORS.map(async (sensor) => {
            const res = await fetch(`/api/firms/${sensor}/${CA_BBOX.join(',')}/5/${start}`);
            if (!res.ok) throw new Error(`FIRMS history ${sensor}: ${res.status}`);
            return parseCSV(await res.text()).map((r) => ({ coords: [Number(r.longitude), Number(r.latitude)], day: r.acq_date }));
        }),
    );
    const data = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    historyCache = { at: Date.now(), data };
    return data;
}
