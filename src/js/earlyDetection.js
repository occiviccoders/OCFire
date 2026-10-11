import { bboxOf, distanceMiles, featureCollection } from './util.js';

const RECENT_HOURS = 12;
const CLUSTER_MI = 1.25;
// Heat this close to a known fire is assumed to be that fire.
const INCIDENT_MI = 5;
const PERIMETER_PAD_DEG = 0.03;
// Hot on this many of the previous five days at the same spot = a fixed heat source, not a new fire.
// Refinery flares are intermittent, so two days is enough.
const PERSISTENT_DAYS = 2;
const PERSISTENT_MI = 0.6;

// A padded bounding box rather than the exact outline: detections ring the edge of a growing fire.
function nearPerimeter([x, y], boxes) {
    return boxes.some(([[w, s], [e, n]]) =>
        x > w - PERIMETER_PAD_DEG && x < e + PERIMETER_PAD_DEG && y > s - PERIMETER_PAD_DEG && y < n + PERIMETER_PAD_DEG);
}

const RANK = { likely: 0, possible: 1, persistent: 2 };

function daysSeenBefore(coords, history) {
    const days = new Set();
    for (const h of history) if (distanceMiles(h.coords, coords) < PERSISTENT_MI) days.add(h.day);
    return days.size;
}

// Group satellite detections that aren't explained by any known fire into candidate new fires.
// `history`: [{ coords, day }] detections from prior days (see fetchHotspotHistory).
export function findUnmatchedHeat(hotspots, incidents, perimeters, history = []) {
    const cutoff = Date.now() - RECENT_HOURS * 3600000;
    const known = perimeters.features.map((f) => bboxOf(f.geometry));
    const incidentPoints = incidents.features.map((f) => f.geometry.coordinates);

    const loose = hotspots.features.filter((f) => {
        const c = f.geometry.coordinates;
        if (Date.parse(f.properties.acquired) < cutoff) return false;
        if (incidentPoints.some((p) => distanceMiles(c, p) < INCIDENT_MI)) return false;
        return !nearPerimeter(c, known);
    });

    // Single-link clustering; detection counts are small (tens), so O(n²) is fine.
    const clusters = [];
    for (const f of loose) {
        const c = f.geometry.coordinates;
        const hits = clusters.filter((cl) => cl.some((g) => distanceMiles(g.geometry.coordinates, c) < CLUSTER_MI));
        const merged = [f, ...hits.flat()];
        for (const h of hits) clusters.splice(clusters.indexOf(h), 1);
        clusters.push(merged);
    }

    return featureCollection(
        clusters.map((cl, i) => {
            const n = cl.length;
            const lng = cl.reduce((a, f) => a + f.geometry.coordinates[0], 0) / n;
            const lat = cl.reduce((a, f) => a + f.geometry.coordinates[1], 0) / n;
            const times = cl.map((f) => Date.parse(f.properties.acquired));
            const satellites = new Set(cl.map((f) => f.properties.satellite));
            const high = cl.filter((f) => f.properties.confidence === 'high').length;
            // Several detections, more than one satellite, or high confidence make a real fire likelier.
            const strength = (n >= 3 ? 1 : 0) + (satellites.size > 1 ? 1 : 0) + (high ? 1 : 0);
            const priorDays = daysSeenBefore([lng, lat], history);
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {
                    id: `heat-${i}-${Math.round(lng * 1000)}-${Math.round(lat * 1000)}`,
                    count: n,
                    satellites: satellites.size,
                    high,
                    maxFrp: Math.max(...cl.map((f) => f.properties.frp)),
                    first: new Date(Math.min(...times)).toISOString(),
                    latest: new Date(Math.max(...times)).toISOString(),
                    strength: priorDays >= PERSISTENT_DAYS ? 'persistent' : strength >= 2 ? 'likely' : 'possible',
                    priorDays,
                    distance: distanceMiles([lng, lat]),
                },
            };
        }).sort((a, b) => RANK[a.properties.strength] - RANK[b.properties.strength] || b.properties.count - a.properties.count),
    );
}
