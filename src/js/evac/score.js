import { compass } from '../wind/fireWeather.js';
import { bearing, distToSegment, inRingXY, kmToMi, projector, resample } from './geometry.js';

const STEP_KM = 0.25;
// CHP coordinates sit on the roadway; within this distance the route is treated as using that road.
const TRAFFIC_HIT_KM = 0.15;

function prepareZones(zones, project) {
    return zones.map((z) => {
        const rings = z.rings.map((r) => r.map(project));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of rings) for (const [x, y] of r) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        return { ...z, ringsXY: rings, bbox: [minX, minY, maxX, maxY] };
    });
}

function bboxDistance([x, y], [minX, minY, maxX, maxY]) {
    const dx = Math.max(minX - x, 0, x - maxX);
    const dy = Math.max(minY - y, 0, y - maxY);
    return Math.hypot(dx, dy);
}

// Distance (km) from a point to the nearest hazard; 0 if inside one.
function nearestHazard(p, zones) {
    let best = { km: Infinity, zone: null };
    for (const z of zones) {
        if (bboxDistance(p, z.bbox) >= best.km) continue;
        for (const ring of z.ringsXY) {
            if (inRingXY(p, ring)) return { km: 0, zone: z };
            for (let i = 1; i < ring.length; i++) {
                const d = distToSegment(p, ring[i - 1], ring[i]);
                if (d < best.km) best = { km: d, zone: z };
            }
        }
    }
    return best;
}

function trafficOnRoute(samples, traffic) {
    const hits = [];
    for (const t of traffic) {
        for (let i = 1; i < samples.length; i++) {
            if (distToSegment(t.xy, samples[i - 1], samples[i]) <= TRAFFIC_HIT_KM) {
                hits.push(t);
                break;
            }
        }
    }
    return hits;
}

function fmtMi(km) {
    const mi = kmToMi(km);
    return mi < 1 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function scoreRoute(route, start, zones, cones, startHazard, traffic) {
    const project = projector(start);
    const samples = resample(route.coords.map(project), STEP_KM);

    let closest = { km: Infinity, zone: null };
    let throughZone = null;
    let downwindKm = 0;
    const coneHits = new Set();
    for (const p of samples) {
        const h = nearestHazard(p, zones);
        if (h.km < closest.km) closest = h;
        if (h.km === 0 && startHazard.km > 0) throughZone ??= h.zone;
        for (const c of cones) {
            if (inRingXY(p, c.polygonXY)) {
                downwindKm += STEP_KM;
                coneHits.add(c.name);
                break;
            }
        }
    }
    const end = nearestHazard(samples.at(-1), zones);
    const trafficHits = traffic ? trafficOnRoute(samples, traffic) : [];
    const blocked = trafficHits.filter((t) => t.severity === 'blocking');
    const crashes = trafficHits.filter((t) => t.severity === 'major');

    // Only penalize getting closer to fire than you already are.
    const closer = closest.km < startHazard.km - 0.3;
    let penalty = 0;
    if (throughZone) penalty += 600;
    else if (closer && closest.km < 1.6) penalty += 120;
    else if (closer && closest.km < 4.8) penalty += 25;
    penalty += downwindKm * 4;
    if (end.km < startHazard.km) penalty += (startHazard.km - end.km) * 3;
    penalty += blocked.length * 150 + crashes.length * 30;

    const status = throughZone ? 'avoid' : (closer && closest.km < 4.8) || downwindKm > 1 || trafficHits.length ? 'caution' : 'good';

    const reasons = [];
    if (throughZone) reasons.push({ tone: 'bad', text: `Passes through the ${throughZone.name}` });
    else if (closest.zone && Number.isFinite(closest.km)) {
        reasons.push(closer && closest.km < 4.8
            ? { tone: closest.km < 1.6 ? 'bad' : 'warn', text: `Gets within ${fmtMi(closest.km)} of the ${closest.zone.name}` }
            : { tone: 'good', text: `Never gets closer to fire than you are now (nearest: ${closest.zone.name}, ${fmtMi(closest.km)})` });
    }
    if (downwindKm > 0.5) reasons.push({ tone: 'warn', text: `${fmtMi(downwindKm)} inside the downwind spread zone of ${[...coneHits].join(', ')}` });
    else if (cones.length) reasons.push({ tone: 'good', text: 'Stays out of downwind spread zones' });
    if (Number.isFinite(end.km) && Number.isFinite(startHazard.km)) {
        const gain = end.km - startHazard.km;
        reasons.push(gain >= 0
            ? { tone: 'good', text: `Ends ${fmtMi(gain)} farther from the nearest fire` }
            : { tone: 'warn', text: `Ends ${fmtMi(-gain)} closer to a fire` });
    }

    for (const t of blocked) reasons.push({ tone: 'bad', text: `${t.label} reported on this route: ${t.location}` });
    for (const t of crashes) reasons.push({ tone: 'warn', text: `${t.label} reported on this route: ${t.location}` });
    if (traffic && !trafficHits.length) reasons.push({ tone: 'good', text: 'No CHP-reported closures or major crashes along the way' });

    const endCoord = route.coords.at(-1);
    const dir = bearing(start, endCoord);
    return { ...route, score: route.minutes + penalty, status, reasons, heading: compass(dir), headingDeg: dir, end: endCoord };
}

function angleDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

// Score every candidate and keep up to `count` distinct options, best first.
// `traffic` = CHP incidents, or null when the feed is unavailable.
export function rankRoutes(routes, start, hazards, rangeMi, traffic = null, count = 3) {
    const project = projector(start);
    const zones = prepareZones(hazards.zones, project);
    const cones = hazards.cones.map((c) => ({ ...c, polygonXY: c.polygon.map(project) }));
    const startHazard = nearestHazard([0, 0], zones);
    const reachKm = rangeMi * 1.609 * 3;
    const nearbyTraffic = traffic && traffic
        .map((t) => ({ ...t, xy: project(t.coords) }))
        .filter((t) => Math.hypot(t.xy[0], t.xy[1]) < reachKm);

    // Long detours mean the road network doesn't really go that way.
    const direct = routes.filter((r) => r.miles <= rangeMi * 2.5);
    const scored = (direct.length ? direct : routes)
        .map((r) => scoreRoute(r, start, zones, cones, startHazard, nearbyTraffic))
        .sort((a, b) => a.score - b.score);
    const picked = [];
    for (const r of scored) {
        const duplicate = picked.some((p) => angleDiff(p.headingDeg, r.headingDeg) < 35);
        if (!duplicate) picked.push(r);
        if (picked.length === count) break;
    }
    return { routes: picked, startHazard: { ...startHazard, mi: kmToMi(startHazard.km) } };
}
