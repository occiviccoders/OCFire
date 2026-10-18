// Shared by the Cloudflare function and the Vite dev server.
// LANDFIRE ImageServer tiles, recolored to wildland fuel only.
import { fuelRenderingRule } from '../src/js/sources/fuel.js';

const SERVICE = 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2025/LF2025_FBFM40_CONUS/ImageServer';
const MERCATOR = 20037508.35;

export function fuelTileUpstream(bbox) {
    const parts = String(bbox || '').split(',');
    if (parts.length !== 4) return null;
    const [w, s, e, n] = parts.map(Number);
    if (![w, s, e, n].every(Number.isFinite) || !(w < e && s < n)) return null;
    if (w < -MERCATOR || s < -MERCATOR || e > MERCATOR || n > MERCATOR) return null;
    // One screen tile. Rejects a request for half the country in a single image.
    if (e - w > 1_600_000 || n - s > 1_600_000) return null;

    const url = new URL(`${SERVICE}/exportImage`);
    url.searchParams.set('bbox', [w, s, e, n].join(','));
    url.searchParams.set('bboxSR', '3857');
    url.searchParams.set('imageSR', '3857');
    url.searchParams.set('size', '256,256');
    url.searchParams.set('format', 'png32');
    url.searchParams.set('transparent', 'true');
    url.searchParams.set('renderingRule', JSON.stringify(fuelRenderingRule()));
    url.searchParams.set('f', 'image');
    return url.toString();
}

export function fuelAtUpstream(lng, lat) {
    const x = Number(lng);
    const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < -130 || x > -65 || y < 24 || y > 50) return null;
    const url = new URL(`${SERVICE}/identify`);
    url.searchParams.set('geometry', JSON.stringify({ x, y, spatialReference: { wkid: 4326 } }));
    url.searchParams.set('geometryType', 'esriGeometryPoint');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('f', 'json');
    return url.toString();
}
