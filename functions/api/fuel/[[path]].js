import { joinPath, notFound, proxy } from '../../../server/proxy.js';
import { fuelAtUpstream, fuelTileUpstream } from '../../../server/fuel.js';

export function onRequest(context) {
    const path = joinPath(context.params.path);
    const url = new URL(context.request.url);
    if (path === 'tiles') {
        const upstream = fuelTileUpstream(url.searchParams.get('bbox'));
        if (!upstream) return notFound();
        return proxy(context, upstream, { ttl: 7 * 86400, type: 'image/png' });
    }
    if (path === 'at') {
        const upstream = fuelAtUpstream(url.searchParams.get('lng'), url.searchParams.get('lat'));
        if (!upstream) return new Response(JSON.stringify({ value: 'NoData' }), { headers: { 'Content-Type': 'application/json' } });
        return proxy(context, upstream, { ttl: 7 * 86400, type: 'application/json' });
    }
    return notFound();
}
