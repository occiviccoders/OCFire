import { cached, featureCollection, fetchJSON } from '../util.js';

// SCE publishes live Public Safety Power Shutoff areas (de-energized or under consideration).
const SCE_PSPS = 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/SCE_PSPS_Monitor_and_Planned_Outage_Areas_Active_P2/FeatureServer/0';
// Cal OES statewide outages aggregated from the utilities (PG&E areas; incident points for all).
const CALOES = 'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View)/FeatureServer';

const geojson = (layer, outFields) =>
    fetchJSON(`${layer}/query?${new URLSearchParams({ where: '1=1', outFields, outSR: '4326', geometryPrecision: '5', f: 'geojson' })}`);

// ArcGIS uses 1900-01-01 as "no date".
const validDate = (ms) => (ms && ms > Date.UTC(2000, 0, 1) ? ms : null);

const isPsps = (cause = '', type = '') => /PUBLIC SAFETY|PSPS/i.test(cause) || /PSPS/i.test(type);

export const fetchPower = cached(loadPower, 3 * 60 * 1000);

async function loadPower() {
    const [sce, areas, points] = await Promise.allSettled([
        geojson(SCE_PSPS, 'CIRCUIT_NAME,COUNTY,GrandTotal,PSPS,PSPS_DETAILS,ERT'),
        geojson(`${CALOES}/1`, 'UtilityCompany,Cause,ImpactedCustomers,OutageType,EstimatedRestoreDate,County'),
        geojson(`${CALOES}/0`, 'UtilityCompany,Cause,ImpactedCustomers,OutageType,EstimatedRestoreDate,County'),
    ]);
    if ([sce, areas, points].every((r) => r.status === 'rejected')) throw sce.reason;

    const polygons = [];
    for (const f of sce.value?.features || []) {
        const p = f.properties;
        polygons.push({
            ...f,
            properties: {
                kind: 'psps',
                utility: 'SCE',
                status: p.PSPS || 'PSPS',
                detail: p.PSPS_DETAILS || '',
                name: p.CIRCUIT_NAME ? `${p.CIRCUIT_NAME} circuit` : '',
                county: p.COUNTY || '',
                customers: p.GrandTotal || 0,
                restore: validDate(p.ERT),
            },
        });
    }
    for (const f of areas.value?.features || []) {
        const p = f.properties;
        polygons.push({
            ...f,
            properties: {
                kind: isPsps(p.Cause) ? 'psps' : 'outage',
                utility: p.UtilityCompany,
                status: isPsps(p.Cause) ? 'Public Safety Power Shutoff' : p.OutageType === 'Planned' ? 'Planned outage' : 'Outage',
                detail: p.Cause || '',
                name: '',
                county: p.County || '',
                customers: p.ImpactedCustomers || 0,
                restore: validDate(p.EstimatedRestoreDate),
            },
        });
    }
    // Points only for utilities without polygons, so PG&E outages aren't drawn twice.
    const polygonUtilities = new Set((areas.value?.features || []).map((f) => f.properties.UtilityCompany));
    const outagePoints = (points.value?.features || [])
        .filter((f) => !polygonUtilities.has(f.properties.UtilityCompany))
        .map((f) => {
            const p = f.properties;
            return {
                ...f,
                properties: {
                    kind: isPsps(p.Cause) ? 'psps' : 'outage',
                    utility: p.UtilityCompany,
                    status: isPsps(p.Cause) ? 'Public Safety Power Shutoff' : p.OutageType === 'Planned' ? 'Planned outage' : 'Outage',
                    detail: p.Cause || '',
                    county: p.County || '',
                    customers: p.ImpactedCustomers || 0,
                    restore: validDate(p.EstimatedRestoreDate),
                },
            };
        });
    return { areas: featureCollection(polygons), points: featureCollection(outagePoints) };
}
