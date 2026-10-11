import { decodePolyline6, destination, miToKm } from './geometry.js';

// FOSSGIS public Valhalla instance (fair use, CORS-enabled). Its exclude_polygons is capped at a
// 10 km circumference, too small for real fires, so routes are scored against hazards afterwards.
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const PHOTON = 'https://photon.komoot.io';
const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const CONCURRENCY = 2;

async function route(start, end, avoid) {
    const res = await fetch(VALHALLA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            locations: [
                { lon: start[0], lat: start[1] },
                { lon: end[0], lat: end[1], radius: 3000 },
            ],
            ...(avoid.length && { exclude_locations: avoid.map(([lon, lat]) => ({ lon, lat })) }),
            costing: 'auto',
            alternates: 1,
            units: 'miles',
            narrative: false,
        }),
    });
    const body = await res.json();
    // 442 = no route between points (ocean, no roads); just skip that direction.
    if (!res.ok) return [];
    return [body.trip, ...(body.alternates || []).map((a) => a.trip)].map((trip) => ({
        coords: decodePolyline6(trip.legs[0].shape),
        minutes: trip.summary.time / 60,
        miles: trip.summary.length,
    }));
}

// Candidate escape routes: drive toward points `rangeMi` out in 8 compass directions.
// `avoid` = [lng, lat] points (road closures etc.) whose nearest road segments are excluded.
export async function fetchCandidateRoutes(start, rangeMi, { avoid = [], onProgress = () => {} } = {}) {
    const targets = DIRECTIONS.map((b) => ({ bearing: b, point: destination(start, b, miToKm(rangeMi)) }));
    const results = [];
    let done = 0;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(batch.map((t) => route(start, t.point, avoid)));
        settled.forEach((r, k) => {
            if (r.status === 'fulfilled') r.value.forEach((rt) => results.push({ ...rt, targetBearing: batch[k].bearing }));
        });
        done += batch.length;
        onProgress(done / targets.length);
    }
    return results;
}

export async function searchPlaces(query, near) {
    const params = new URLSearchParams({ q: query, limit: '5', lat: String(near[1]), lon: String(near[0]), bbox: '-124.6,32.4,-114.0,42.1' });
    const res = await fetch(`${PHOTON}/api/?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.features.map((f) => {
        const p = f.properties;
        const label = [p.name, p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.city || p.county].filter(Boolean);
        return { label: [...new Set(label)].join(', '), coords: f.geometry.coordinates };
    });
}

export async function placeName([lng, lat]) {
    try {
        const res = await fetch(`${PHOTON}/reverse?lon=${lng}&lat=${lat}&limit=1`);
        const p = (await res.json()).features[0]?.properties;
        if (!p) return null;
        const town = p.city || p.district || p.locality;
        if (town) return town;
        const county = p.county && `${p.county.replace(/ County$/, '')} County`;
        return [p.street, county].filter(Boolean).join(', ') || p.name || null;
    } catch {
        return null;
    }
}
