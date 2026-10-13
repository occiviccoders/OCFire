import { bboxOf, distanceMiles, featureCollection } from './util.js';
import { pointInGeometry } from './geo.js';
import { historyAt } from './sources/baseline.js';
import { compass } from './wind/fireWeather.js';
import { DRY_DAYS_MAX, landKind, landLabel } from './siteFacts.js';

export const RECENT_HOURS = 12;
export const CLUSTER_MI = 1.25;
// Heat this close to a known fire is assumed to be that fire.
export const INCIDENT_MI = 5;
const PERIMETER_PAD_DEG = 0.03;
// Hot on this many of the previous five days at the same spot = a fixed heat source, not a new fire.
// Refinery flares are intermittent, so two days is enough.
export const PERSISTENT_DAYS = 2;
const PERSISTENT_MI = 0.6;

// A padded bounding box rather than the exact outline: detections ring the edge of a growing fire.
function nearPerimeter([x, y], boxes) {
    return boxes.some(([[w, s], [e, n]]) =>
        x > w - PERIMETER_PAD_DEG && x < e + PERIMETER_PAD_DEG && y > s - PERIMETER_PAD_DEG && y < n + PERIMETER_PAD_DEG);
}

const RANK = { likely: 0, possible: 1, persistent: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Past-year days hot within ~1 km: at or above this reads as a farm, flare, or landfill.
const RECURRING_DAYS = 15;
const STRONG_FRP_MW = 20;
const DRIFT_MI = 0.3;

export function daysSeenBefore(coords, history) {
    const days = new Set();
    for (const h of history) if (distanceMiles(h.coords, coords) < PERSISTENT_MI) days.add(h.day);
    return days.size;
}

function monthList(mask) {
    return MONTHS.filter((_, i) => mask & (1 << i)).join(', ');
}

function bearing([lng1, lat1], [lng2, lat2]) {
    const rad = Math.PI / 180;
    const y = Math.sin((lng2 - lng1) * rad) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
    return ((Math.atan2(y, x) / rad) + 360) % 360;
}

// Bump whenever assess() changes, so stored research snapshots record which rules produced them.
export const RULES_VERSION = 3;
const RAINY_IN = 0.25;

function siteReasons(site, add) {
    if (!site) return;
    const kind = landKind(site.land);
    const label = landLabel(site.land);
    if (kind === 'wildland') add(1, 'watch', `In wildland (${label}), away from farm fields and buildings`);
    else if (kind === 'farm') add(-1, 'calm', `On ${label}, where field and crop burning is common`);
    else if (kind === 'developed') add(0, 'info', 'In a developed area: could be a building, vehicle or industrial fire');
    else if (kind === 'barren') add(-1, 'calm', `On ${label}, which can show up as heat`);
    else if (kind === 'water') add(-1, 'calm', 'Over water: likely a boat, platform or sensor glitch');

    if (site.thunder3) add(2, 'alert', 'Thunderstorms in the area in the past 3 days (weather model). Lightning fires can smolder for days before flaring up');
    if (site.rain3 >= RAINY_IN) add(-1, 'calm', `${site.rain3}" of rain here in the past 3 days`);
    else if (site.dryDays >= DRY_DAYS_MAX) add(0, 'watch', 'No rain here in the past 2 weeks');
}

// How strong the fire signal is for a cluster: a points tally with the reasons shown to the user.
// It's a ranking aid, not a calibrated probability of fire. Also used by workers/collector.
// cluster: detection features with properties.acquired and daynight; info: { count, satellites, high, maxFrp }.
// site: { land, rain3, thunder3, dryDays } from siteFacts.js, or null while it loads.
export function assess(cluster, info, { past, priorDays, wind, redFlag, site = null }) {
    const reasons = [];
    let score = 0;
    const add = (points, tone, text) => {
        score += points;
        reasons.push({ tone, text });
    };

    if (past) {
        const season = past.months & (1 << new Date().getMonth()) ? ', including this time of year' : '';
        if (past.static) add(-2, 'calm', 'NASA classifies this spot as an industrial heat source');
        else if (past.days === 0) add(2, 'alert', 'No satellite heat within about 1 km in the past year');
        else if (past.days <= 3) add(1, 'watch', `Rarely hot here: ${past.days} day${past.days === 1 ? '' : 's'} in the past year`);
        else if (past.days < RECURRING_DAYS) add(0, 'info', `Sometimes hot here: ${past.days} days in the past year (${monthList(past.months)})${season}`);
        else add(-2, 'calm', `Hot on ${past.days} days in the past year${season}, typical of a farm, flare, or landfill`);
    }
    if (priorDays >= PERSISTENT_DAYS) add(-2, 'calm', `Hot on ${priorDays} of the previous 5 days`);

    if (info.count >= 3) add(1, 'watch', `${info.count} detections`);
    else if (info.count === 1) add(0, 'calm', 'Only one detection so far');
    if (info.satellites > 1) add(1, 'watch', `Seen by ${info.satellites} satellites`);
    else if (info.count > 1) add(0, 'calm', 'Seen by only one satellite');
    if (info.high) add(1, 'watch', 'High-confidence detection');
    if (info.maxFrp >= STRONG_FRP_MW) add(1, 'watch', `Strong heat output: ${Math.round(info.maxFrp)} MW`);
    if (cluster.some((f) => f.properties.daynight === 'N')) add(1, 'watch', 'Seen at night, when farm and debris burning are rare');
    siteReasons(site, add);

    if (redFlag) add(1, 'alert', 'Inside a Red Flag Warning');
    if (wind?.level === 'critical') add(1, 'alert', `Red-flag-level weather here: gusts ${Math.round(wind.gust)} mph, humidity ${Math.round(wind.rh)}%`);
    else if (wind?.level === 'elevated') add(1, 'watch', `Elevated fire weather here: gusts ${Math.round(wind.gust)} mph, humidity ${Math.round(wind.rh)}%`);
    else if (wind && !redFlag) add(0, 'calm', `No fire-weather concern here right now (gusts ${Math.round(wind.gust)} mph, humidity ${Math.round(wind.rh)}%)`);

    // Across satellite passes, did the heat move the way the wind blows? GOES pixels (~2 km) are too coarse for this.
    const sorted = cluster.filter((f) => !f.properties.goes).sort((a, b) => Date.parse(a.properties.acquired) - Date.parse(b.properties.acquired));
    const firstTime = sorted.length ? Date.parse(sorted[0].properties.acquired) : 0;
    const later = sorted.filter((f) => Date.parse(f.properties.acquired) - firstTime > 30 * 60000);
    if (wind && later.length) {
        const start = sorted[0].geometry.coordinates;
        const end = [later.reduce((a, f) => a + f.geometry.coordinates[0], 0) / later.length, later.reduce((a, f) => a + f.geometry.coordinates[1], 0) / later.length];
        const drift = distanceMiles(start, end);
        const toward = (wind.dir + 180) % 360;
        const off = Math.abs(((bearing(start, end) - toward + 540) % 360) - 180);
        if (drift >= DRIFT_MI && off <= 45) add(2, 'alert', `Later detections are ${drift.toFixed(1)} mi ${compass(toward)} of the first, in line with the wind`);
    }

    const level = score >= 5 ? 'high' : score >= 3 ? 'moderate' : 'low';
    return { score, level, reasons };
}

// Group satellite detections that aren't explained by any known fire into candidate new fires.
// context.history: [{ coords, day }] detections from the previous 5 days (see fetchHotspotHistory).
// context.baseline: one-year cell history (see fetchBaseline). context.windAt(coords): current conditions.
// context.fireWeather: NWS Red Flag Warning / Fire Weather Watch polygons.
// context.reported: NIFC incident locations (see sources/reportedIncidents.js), treated like CAL FIRE incidents.
// context.siteAt(coords): siteFacts for a cluster center once loaded, else null.
export function findUnmatchedHeat(hotspots, incidents, perimeters, { history = [], baseline = null, windAt = () => null, siteAt = () => null, fireWeather = null, reported = null } = {}) {
    const redFlags = (fireWeather?.features || []).filter((f) => f.properties.event === 'Red Flag Warning');
    const cutoff = Date.now() - RECENT_HOURS * 3600000;
    const known = perimeters.features.map((f) => bboxOf(f.geometry));
    const incidentPoints = [...incidents.features, ...(reported?.features || [])].map((f) => f.geometry.coordinates);

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
        clusters.map((cl) => {
            // GOES rescans every 5–10 min, so each GOES satellite counts once; its coarse pixels don't move the center.
            const precise = cl.filter((f) => !f.properties.goes);
            const n = precise.length + new Set(cl.filter((f) => f.properties.goes).map((f) => f.properties.satellite)).size;
            const located = precise.length ? precise : cl;
            const lng = located.reduce((a, f) => a + f.geometry.coordinates[0], 0) / located.length;
            const lat = located.reduce((a, f) => a + f.geometry.coordinates[1], 0) / located.length;
            const times = cl.map((f) => Date.parse(f.properties.acquired));
            const satellites = new Set(cl.map((f) => f.properties.satellite));
            const high = cl.filter((f) => f.properties.confidence === 'high').length;
            // Several detections, more than one satellite, or high confidence make a real fire likelier.
            const strength = (n >= 3 ? 1 : 0) + (satellites.size > 1 ? 1 : 0) + (high ? 1 : 0);
            const priorDays = daysSeenBefore([lng, lat], history);
            const info = { count: n, satellites: satellites.size, high, maxFrp: Math.max(...cl.map((f) => f.properties.frp)) };
            const past = historyAt(baseline, [lng, lat]);
            const unusual = assess(cl, info, {
                past,
                priorDays,
                wind: windAt([lng, lat]),
                redFlag: redFlags.some((f) => pointInGeometry([lng, lat], f.geometry)),
                site: siteAt([lng, lat]),
            });
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {
                    id: `heat-${Math.round(lng * 1000)}-${Math.round(lat * 1000)}`,
                    ...info,
                    first: new Date(Math.min(...times)).toISOString(),
                    latest: new Date(Math.max(...times)).toISOString(),
                    strength: priorDays >= PERSISTENT_DAYS ? 'persistent' : strength >= 2 ? 'likely' : 'possible',
                    priorDays,
                    pastDays: past?.days ?? null,
                    unusual: unusual.level,
                    score: unusual.score,
                    // MapLibre flattens nested properties, so reasons travel as JSON.
                    reasons: JSON.stringify(unusual.reasons),
                    distance: distanceMiles([lng, lat]),
                },
            };
        }).sort((a, b) => RANK[a.properties.strength] - RANK[b.properties.strength] || b.properties.score - a.properties.score || b.properties.count - a.properties.count),
    );
}
