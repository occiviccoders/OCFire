import { notFound, proxy } from '../../../server/proxy.js';
import { LANDCOVER_POINT, landcoverUrl } from '../../../server/landcover.js';

export function onRequest(context) {
    const point = context.params.point;
    if (!LANDCOVER_POINT.test(point)) return notFound();
    return proxy(context, landcoverUrl(point), { ttl: 30 * 86400, type: 'application/json' });
}
