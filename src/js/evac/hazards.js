import { conditionsAt, compass, downwind } from '../wind/fireWeather.js';
import { distanceMiles, bboxOf, featureCollection } from '../util.js';
import { circle, cone, miToKm, polygonsOf } from './geometry.js';

const HOTSPOT_RADIUS_KM = 0.4;
const MIN_WIND_FOR_CONE_MPH = 4;
export const HYPOTHETICAL_RADIUS_MI = 1;

function centerOf(geometry) {
    const [[w, s], [e, n]] = bboxOf(geometry);
    return { center: [(w + e) / 2, (s + n) / 2], halfSpanKm: Math.hypot((e - w) * 92, (n - s) * 111) / 2 };
}

function radiusFromAcres(acres) {
    return Math.max(0.3, Math.sqrt(((acres || 1) * 4046.86) / Math.PI) / 1000);
}

// Where a fire would most likely run with the forecast wind: a 60° wedge downwind of it.
function spreadCone(hazard, forecast, hour) {
    if (!forecast) return null;
    const wind = conditionsAt(forecast, hour, hazard.center);
    if (!wind || wind.speed < MIN_WIND_FOR_CONE_MPH) return null;
    const lengthMi = Math.min(15, Math.max(3, wind.speed * 0.5));
    return {
        name: hazard.name,
        polygon: cone(hazard.center, wind.dir + 180, (hazard.radiusKm || 0) + miToKm(lengthMi)),
        wind,
        label: `${hazard.name}: wind from the ${compass(wind.dir)} at ${Math.round(wind.speed)} mph would push it ${downwind(wind.dir)}`,
    };
}

// Fire areas a route should stay away from, plus downwind spread wedges.
export function buildHazards({ start, rangeMi, perimeters, incidents, hotspots, hypothetical, forecast, hour }) {
    const reachMi = rangeMi + 40;
    const near = (coords) => distanceMiles(coords, start) <= reachMi;
    const zones = [];

    for (const f of perimeters.features) {
        const { center, halfSpanKm } = centerOf(f.geometry);
        if (!near(center)) continue;
        zones.push({
            name: `${f.properties.name} Fire perimeter`,
            kind: 'perimeter',
            rings: polygonsOf(f.geometry).map((p) => p[0]),
            center,
            radiusKm: halfSpanKm,
            active: (f.properties.contained ?? 0) < 100,
        });
    }

    for (const f of incidents.features) {
        if (f.properties.hasPerimeter || !near(f.geometry.coordinates)) continue;
        const radiusKm = radiusFromAcres(f.properties.acres);
        zones.push({
            name: f.properties.name,
            kind: 'incident',
            rings: [circle(f.geometry.coordinates, radiusKm)],
            center: f.geometry.coordinates,
            radiusKm,
            active: (f.properties.contained ?? 0) < 100,
        });
    }

    for (const f of hotspots?.features || []) {
        if (f.properties.persistent || !near(f.geometry.coordinates)) continue;
        zones.push({
            name: 'Satellite hotspot',
            kind: 'hotspot',
            rings: [circle(f.geometry.coordinates, HOTSPOT_RADIUS_KM, 12)],
            center: f.geometry.coordinates,
            radiusKm: HOTSPOT_RADIUS_KM,
            active: true,
        });
    }

    if (hypothetical) {
        const radiusKm = miToKm(HYPOTHETICAL_RADIUS_MI);
        zones.push({
            name: 'Hypothetical fire',
            kind: 'hypothetical',
            rings: [circle(hypothetical, radiusKm)],
            center: hypothetical,
            radiusKm,
            active: true,
        });
    }

    const cones = zones
        .filter((z) => z.active && z.kind !== 'hotspot')
        .map((z) => spreadCone(z, forecast, hour))
        .filter(Boolean);

    return { zones, cones };
}

export function hazardDisplay({ zones, cones }) {
    return {
        zones: featureCollection(
            zones
                .filter((z) => z.kind === 'hypothetical' || z.kind === 'incident')
                .map((z) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [z.rings[0]] }, properties: { kind: z.kind, name: z.name } })),
        ),
        cones: featureCollection(cones.map((c) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [c.polygon] }, properties: { name: c.name, label: c.label } }))),
    };
}
