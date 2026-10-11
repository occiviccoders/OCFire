import { CA_BBOX } from '../config.js';
import { featureCollection } from '../util.js';

// NOAA Hazard Mapping System: analysts trace smoke plumes on GOES/polar satellite imagery several
// times a day. One KML per UTC day; early in the day it may not exist yet, so fall back a day.
const DENSITY = { Light: 1, Medium: 2, Heavy: 3 };

function dayPath(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return { url: `/api/hms/${y}/${m}/hms_smoke${y}${m}${d}.kml`, label: `${y}-${m}-${d}` };
}

function parseCoords(text) {
    return text.trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number));
}

// Plumes cover the continent; keep only ones touching a padded California box.
function touchesCalifornia(ring) {
    const [w, s, e, n] = CA_BBOX;
    return ring.some(([x, y]) => x > w - 3 && x < e + 3 && y > s - 3 && y < n + 3);
}

function parseKML(text, day) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const features = [];
    for (const folder of doc.getElementsByTagName('Folder')) {
        const name = folder.getElementsByTagName('name')[0]?.textContent || '';
        const density = name.match(/Smoke \((\w+)\)/)?.[1];
        if (!DENSITY[density]) continue;
        for (const poly of folder.getElementsByTagName('Polygon')) {
            const outer = poly.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0];
            if (!outer) continue;
            const ring = parseCoords(outer.textContent);
            if (ring.length < 4 || !touchesCalifornia(ring)) continue;
            features.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [ring] },
                properties: { density, level: DENSITY[density], day },
            });
        }
    }
    return features;
}

export async function fetchSmoke() {
    for (const offset of [0, 1]) {
        const { url, label } = dayPath(new Date(Date.now() - offset * 86400000));
        const res = await fetch(url);
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.includes('<kml')) continue;
        return featureCollection(parseKML(text, label));
    }
    throw new Error('NOAA HMS smoke: no recent analysis');
}
