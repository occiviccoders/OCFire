import { joinPath, notFound, proxy } from '../../../server/proxy.js';

const ALLOWED = /^\d{4}\/\d{2}\/hms_smoke\d{8}\.kml$/;

export function onRequest(context) {
    const path = joinPath(context.params.path);
    if (!ALLOWED.test(path)) return notFound();
    return proxy(context, `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/${path}`, {
        ttl: 600,
        type: 'application/vnd.google-earth.kml+xml',
    });
}
