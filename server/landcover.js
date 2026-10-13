// USGS/MRLC National Land Cover Database (NLCD 2021) class at a point, via WMS GetFeatureInfo.
// Shared by functions/api/landcover and the Vite dev proxy. Point format: "lat,lng".
export const LANDCOVER_POINT = /^-?\d{1,2}\.\d{1,4},-?\d{1,3}\.\d{1,4}$/;

export function landcoverUrl(point) {
    const [lat, lng] = point.split(',').map(Number);
    const d = 0.0005;
    const params = new URLSearchParams({
        service: 'WMS',
        version: '1.1.1',
        request: 'GetFeatureInfo',
        layers: 'NLCD_2021_Land_Cover_L48',
        query_layers: 'NLCD_2021_Land_Cover_L48',
        srs: 'EPSG:4326',
        bbox: [lng - d, lat - d, lng + d, lat + d].join(','),
        width: '3',
        height: '3',
        x: '1',
        y: '1',
        info_format: 'application/json',
    });
    return `https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows?${params}`;
}
