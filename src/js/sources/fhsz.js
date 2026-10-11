import { featureCollection, fetchJSON } from '../util.js';

// CAL FIRE / OSFM Fire Hazard Severity Zones (2024–25 maps, State and Local Responsibility Areas) —
// the layer used for real-estate disclosure.
const LAYER = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/fhsz24_5/FeatureServer/0';
export const FHSZ_MIN_ZOOM = 9;

export const FHSZ_INFO = {
    1: { label: 'Moderate', color: '#f2d64b' },
    2: { label: 'High', color: '#f08c2e' },
    3: { label: 'Very High', color: '#d7301f' },
};

// "SRA Very High" → who's responsible: the state (CAL FIRE) or the local fire department.
function responsibility(cls = '') {
    return cls.startsWith('SRA') ? 'State Responsibility Area (CAL FIRE)' : 'Local Responsibility Area (city / county fire)';
}

// Polygons in the current view, simplified to roughly one screen pixel.
export async function fetchZonesInView([[w, s], [e, n]], zoom) {
    const params = new URLSearchParams({
        where: '1=1',
        geometry: [w, s, e, n].join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'FHSZ,FHSZ_7Class',
        outSR: '4326',
        maxAllowableOffset: String(360 / (512 * 2 ** zoom)),
        geometryPrecision: '5',
        resultRecordCount: '2000',
        f: 'geojson',
    });
    const data = await fetchJSON(`${LAYER}/query?${params}`);
    return featureCollection(
        data.features.map((f) => ({
            ...f,
            properties: { fhsz: f.properties.FHSZ, label: FHSZ_INFO[f.properties.FHSZ]?.label, area: responsibility(f.properties.FHSZ_7Class) },
        })),
    );
}

// { level, label, area } for the zone containing a point, or null if it's not in a mapped zone.
export async function zoneAt([lng, lat]) {
    const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'FHSZ,FHSZ_7Class',
        returnGeometry: 'false',
        f: 'json',
    });
    const data = await fetchJSON(`${LAYER}/query?${params}`);
    const best = data.features.map((f) => f.attributes).sort((a, b) => b.FHSZ - a.FHSZ)[0];
    return best ? { level: best.FHSZ, label: FHSZ_INFO[best.FHSZ].label, area: responsibility(best.FHSZ_7Class) } : null;
}

export const FHSZ_MEANING = {
    3: 'Very High zones carry the strictest rules: 100 ft of defensible space is required by law, new and remodeled homes must meet the wildfire building code (Chapter 7A), and the zone must be disclosed when the home is sold. An ember-resistant “Zone 0” within 5 ft of the house is being phased in.',
    2: 'High zones require 100 ft of defensible space in State Responsibility Areas, wildfire building-code standards for new construction, and disclosure when the home is sold.',
    1: 'Moderate zones still burn — wind-driven embers travel a mile or more — but carry fewer legal requirements. Defensible space and ember-resistant vents are still worth doing.',
};
