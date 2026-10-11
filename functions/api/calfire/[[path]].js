import { joinPath, notFound, proxy } from '../../../server/proxy.js';

export function onRequest(context) {
    const path = joinPath(context.params.path);
    if (!path.startsWith('umbraco/api/IncidentApi/')) return notFound();
    const { search } = new URL(context.request.url);
    return proxy(context, `https://incidents.fire.ca.gov/${path}${search}`, { ttl: 120, type: 'application/json' });
}
