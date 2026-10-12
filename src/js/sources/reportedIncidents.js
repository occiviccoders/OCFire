import { cached, fetchJSON, featureCollection } from '../util.js';

// NIFC WFIGS incident locations (year-to-date layer; contained fires drop out of the "Current" one):
// every wildfire dispatched in California, including small initial-attack fires that never make CAL FIRE's
// public list. Only used to tell whether satellite heat is already a reported fire; it isn't drawn on the
// map. Proxied via /api/perimeters/incidents.
const ENDPOINT = '/api/perimeters/incidents';
const LOOKBACK_DAYS = 14;

export const fetchReportedIncidents = cached(loadReportedIncidents, 5 * 60 * 1000);

async function loadReportedIncidents() {
    // Day-rounded so the URL (and the edge cache entry) stays the same all day.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const search = new URLSearchParams({
        where: `POOState='US-CA' AND IncidentTypeCategory='WF' AND FireDiscoveryDateTime >= TIMESTAMP '${since} 00:00:00'`,
        outFields: 'IrwinID,IncidentName,FireDiscoveryDateTime,IncidentSize,PercentContained,POOCounty,FireOutDateTime',
        geometryPrecision: '5',
        resultRecordCount: '2000',
        f: 'geojson',
    });
    const data = await fetchJSON(`${ENDPOINT}?${search}`);
    return featureCollection(
        (data.features || [])
            .filter((f) => f.geometry)
            .map((f) => {
                const p = f.properties;
                return {
                    type: 'Feature',
                    geometry: f.geometry,
                    properties: {
                        id: p.IrwinID,
                        name: (p.IncidentName || 'Unnamed').trim(),
                        discovered: p.FireDiscoveryDateTime,
                        acres: p.IncidentSize,
                        contained: p.PercentContained,
                        county: p.POOCounty,
                        out: p.FireOutDateTime,
                    },
                };
            }),
    );
}
