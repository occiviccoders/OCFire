import { joinPath, notFound, proxy } from '../../../server/proxy.js';

// Active alerts change often; zone outlines almost never.
const ROUTES = [
    { match: /^alerts\/active$/, ttl: 120 },
    { match: /^zones\/(fire|forecast|county)\/[A-Z]{3}\d{3}$/, ttl: 86400 },
];

export function onRequest(context) {
    const path = joinPath(context.params.path);
    const route = ROUTES.find((r) => r.match.test(path));
    if (!route) return notFound();
    const { search } = new URL(context.request.url);
    return proxy(context, `https://api.weather.gov/${path}${search}`, {
        ttl: route.ttl,
        type: 'application/geo+json',
        headers: { Accept: 'application/geo+json' },
    });
}
