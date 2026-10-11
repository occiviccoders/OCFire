// Shared by the Cloudflare Pages Functions in /functions/api, which stand in for the Vite dev proxies
// in production. Responses are cached at the edge so every visitor shares one upstream fetch.

export const USER_AGENT = 'California Fire Watch (info@initialapps.com)';

export async function proxy(context, upstream, { ttl, type = 'text/plain', headers = {} }) {
    const { request } = context;
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    // Keyed on our URL, not the upstream one, so API keys never end up in the cache key.
    const cacheKey = new Request(request.url);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let upstreamRes;
    try {
        upstreamRes = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    } catch (err) {
        return new Response(`Upstream unavailable: ${err.message}`, { status: 502 });
    }

    const res = new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
            'Content-Type': upstreamRes.headers.get('Content-Type') || type,
            'Cache-Control': `public, max-age=${ttl}`,
        },
    });
    if (upstreamRes.ok) context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
}

export const notFound = () => new Response('Not found', { status: 404 });

// [[path]] catch-all params arrive as an array of segments.
export const joinPath = (path) => (Array.isArray(path) ? path.join('/') : path || '');
