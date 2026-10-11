import { joinPath, notFound, proxy } from '../../../server/proxy.js';

// {sensor}/{west,south,east,north}/{days}[/{YYYY-MM-DD}]
const ALLOWED = /^[A-Z0-9_]+\/[-\d.,]+\/\d{1,2}(\/\d{4}-\d{2}-\d{2})?$/;

export function onRequest(context) {
    const key = context.env.FIRMS_MAP_KEY;
    if (!key) return new Response('FIRMS_MAP_KEY is not configured', { status: 503 });
    const path = joinPath(context.params.path);
    if (!ALLOWED.test(path)) return notFound();
    return proxy(context, `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${path}`, { ttl: 300, type: 'text/csv' });
}
