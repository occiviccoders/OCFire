import { cached, fetchJSON, featureCollection, distanceMiles } from '../util.js';

// CAL FIRE public incident feed, proxied (vite.config.js locally, functions/api/calfire in production).
const ENDPOINT = '/api/calfire/umbraco/api/IncidentApi/GeoJsonList?inactive=false';

export const fetchIncidents = cached(loadIncidents, 60 * 1000);

async function loadIncidents() {
    const data = await fetchJSON(ENDPOINT);

    const features = data.features
        .filter((f) => f.properties.IsActive && f.geometry)
        .map((f) => {
            const p = f.properties;
            const coords = f.geometry.coordinates;
            return {
                type: 'Feature',
                id: p.UniqueId,
                geometry: f.geometry,
                properties: {
                    id: p.UniqueId,
                    name: (p.Name || 'Unnamed').trim(),
                    acres: p.AcresBurned,
                    contained: p.PercentContained,
                    county: p.County,
                    location: (p.Location || '').trim(),
                    adminUnit: p.AdminUnit,
                    type: p.Type,
                    started: p.Started,
                    updated: p.Updated,
                    url: p.Url,
                    distance: distanceMiles(coords),
                },
            };
        })
        .sort((a, b) => a.properties.distance - b.properties.distance);

    return featureCollection(features);
}
