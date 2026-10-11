import { cached, fetchJSON, featureCollection, normalizeName } from '../util.js';

// Two ArcGIS Feature Services, merged and de-duplicated by incident name (newest polygon wins):
//  - FIRIS combo layer: CAL FIRE / FIRIS / USFS intel-flight perimeters. Best coverage for California,
//    but it keeps every historical polygon per fire and has no containment.
//  - NIFC WFIGS current perimeters: interagency, includes containment, but sparse for CA.
// Both go through /api/perimeters (vite.config.js / functions/api/perimeters) so they're cached for everyone.
const FIRIS = '/api/perimeters/firis';
const WFIGS = '/api/perimeters/wfigs';

function titleCase(name) {
    return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

async function query(service, params) {
    const search = new URLSearchParams({ geometryPrecision: '5', f: 'geojson', ...params });
    const data = await fetchJSON(`${service}?${search}`);
    return data.features.filter((f) => f.geometry);
}

async function fetchFiris() {
    const features = await query(FIRIS, {
        where: "displayStatus='Active'",
        outFields: 'incident_name,mission,area_acres,source,poly_DateCurrent,FireDiscoveryDate',
    });
    return features.map((f) => {
        const p = f.properties;
        const name = p.incident_name || p.mission?.split('-')[2] || 'Unnamed';
        return {
            geometry: f.geometry,
            properties: {
                name: titleCase(name.trim()),
                acres: p.area_acres,
                contained: null,
                source: p.source,
                discovered: p.FireDiscoveryDate,
                updated: p.poly_DateCurrent,
            },
        };
    });
}

async function fetchWfigs() {
    const features = await query(WFIGS, {
        where: "attr_POOState='US-CA'",
        outFields: 'poly_IncidentName,attr_IncidentName,poly_GISAcres,attr_PercentContained,attr_IncidentTypeCategory,attr_POOCounty,attr_FireDiscoveryDateTime,poly_DateCurrent,attr_FireCauseGeneral,attr_TotalIncidentPersonnel',
    });
    return features.map((f) => {
        const p = f.properties;
        return {
            geometry: f.geometry,
            properties: {
                name: titleCase((p.attr_IncidentName || p.poly_IncidentName || 'Unnamed').trim()),
                acres: p.poly_GISAcres,
                contained: p.attr_PercentContained,
                prescribed: p.attr_IncidentTypeCategory === 'RX',
                county: p.attr_POOCounty,
                cause: p.attr_FireCauseGeneral,
                personnel: p.attr_TotalIncidentPersonnel,
                source: 'NIFC WFIGS',
                discovered: p.attr_FireDiscoveryDateTime,
                updated: p.poly_DateCurrent,
            },
        };
    });
}

// Returns the newest perimeter per fire plus the older polygons, which become progression rings.
export const fetchPerimeters = cached(loadPerimeters, 2 * 60 * 1000);

async function loadPerimeters() {
    const results = await Promise.allSettled([fetchFiris(), fetchWfigs()]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason;

    const byFire = new Map();
    for (const f of ok.flatMap((r) => r.value)) {
        const key = normalizeName(f.properties.name);
        if (!byFire.has(key)) byFire.set(key, []);
        byFire.get(key).push(f);
    }

    const current = [];
    const history = [];
    for (const versions of byFire.values()) {
        versions.sort((a, b) => (b.properties.updated || 0) - (a.properties.updated || 0));
        const [latest, ...older] = versions;
        // Keep the freshest geometry, but don't lose attributes only another feed has.
        for (const o of older) {
            for (const [k, v] of Object.entries(o.properties)) {
                if (latest.properties[k] == null && v != null) latest.properties[k] = v;
            }
        }
        current.push(latest);

        const span = (latest.properties.updated || 0) - (older.at(-1)?.properties.updated || 0) || 1;
        let lastKeptAcres = latest.properties.acres || 0;
        for (const o of older) {
            // Only keep rings that show real growth; re-flights of the same footprint just stack up on the edge.
            const acres = o.properties.acres || 0;
            if (acres > lastKeptAcres * 0.95) continue;
            lastKeptAcres = acres;
            history.push({
                type: 'Feature',
                geometry: o.geometry,
                properties: {
                    name: latest.properties.name,
                    updated: o.properties.updated,
                    acres: o.properties.acres,
                    age: ((latest.properties.updated || 0) - (o.properties.updated || 0)) / span,
                },
            });
        }
    }

    return {
        current: featureCollection(current.map((f, i) => ({ type: 'Feature', id: i, ...f }))),
        history: featureCollection(history),
    };
}

// Cross-links perimeters and CAL FIRE incidents: perimeters gain containment/county, incidents learn
// whether they have a mapped perimeter (their marker then hands off to it when zoomed in).
export function linkPerimeters(perimeters, incidents) {
    const byName = new Map(incidents.features.map((f) => [normalizeName(f.properties.name), f.properties]));
    for (const f of perimeters.features) {
        const match = byName.get(normalizeName(f.properties.name));
        if (!match) continue;
        f.properties.contained ??= match.contained;
        f.properties.county ??= match.county;
        f.properties.incidentId = match.id;
        match.hasPerimeter = true;
    }
    return perimeters;
}
