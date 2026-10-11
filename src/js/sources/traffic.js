// CHP live incident feed (statewide CAD log, refreshed by CHP about every minute).
const CHP_URL = '/api/chp';
const CACHE_MS = 2 * 60 * 1000;

// Incidents that block or close a road: routes are told to avoid them.
const BLOCKING = [
    [/^CLOSURE/i, 'Road closure'],
    [/^SIG Alert/i, 'SigAlert'],
    [/^1144/, 'Fatal crash'],
    [/^FLOOD/i, 'Roadway flooding'],
    [/^SLIDE/i, 'Mud / rock slide'],
];
// Serious but usually not a full closure: routes passing them are flagged.
const MAJOR = [
    [/^1179|^1183|^1181|^20001/, 'Injury crash'],
    [/^FIRE/i, 'Reported fire'],
];

function classify(type) {
    for (const [re, label] of BLOCKING) if (re.test(type)) return { severity: 'blocking', label };
    for (const [re, label] of MAJOR) if (re.test(type)) return { severity: 'major', label };
    return null;
}

const text = (log, tag) => (log.getElementsByTagName(tag)[0]?.textContent || '').replace(/^"|"$/g, '').trim();

// "38586231:121448700" → [-121.4487, 38.586231] (west longitudes are unsigned).
function parseLatLon(raw) {
    const [lat, lon] = raw.split(':').map(Number);
    if (!lat || !lon) return null;
    return [-lon / 1e6, lat / 1e6];
}

// "Oct 11 2026 11:49AM" (Pacific) — browsers need a space before AM/PM.
function parseLogTime(raw) {
    const d = new Date(raw.replace(/(\d)(AM|PM)$/i, '$1 $2'));
    return Number.isNaN(d.getTime()) ? null : d;
}

// LocationDesc is free text; dispatchers sometimes leave notes ("** DUPES **") or a center code ("OCCC").
function readableLocation(desc) {
    return desc.length > 5 && !desc.includes('*') ? desc : '';
}

let cache = { at: 0, data: [] };

export async function fetchTrafficIncidents() {
    if (Date.now() - cache.at < CACHE_MS) return cache.data;
    const res = await fetch(CHP_URL);
    if (!res.ok) throw new Error(`CHP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const incidents = [];
    for (const log of doc.getElementsByTagName('Log')) {
        const kind = classify(text(log, 'LogType'));
        const coords = parseLatLon(text(log, 'LATLON'));
        if (!kind || !coords) continue;
        incidents.push({
            id: log.getAttribute('ID'),
            ...kind,
            location: readableLocation(text(log, 'LocationDesc')) || text(log, 'Location'),
            area: text(log, 'Area'),
            time: parseLogTime(text(log, 'LogTime')),
            coords,
        });
    }
    cache = { at: Date.now(), data: incidents };
    return incidents;
}

export function trafficGeoJSON(incidents) {
    return {
        type: 'FeatureCollection',
        features: incidents.map((t) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: t.coords },
            properties: { id: t.id, severity: t.severity, label: t.label, location: t.location, area: t.area, time: t.time?.toISOString() ?? null },
        })),
    };
}
