import { USER_AGENT, joinPath, notFound } from '../../../server/proxy.js';
import { drynessAtUpstream, drynessPercent, drynessTileUpstream, recolorDryness } from '../../../server/dryness.js';

const TTL = 3 * 60 * 60;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
    });
}

async function cached(context, respond) {
    const cache = caches.default;
    const hit = await cache.match(context.request);
    if (hit) return hit;
    const res = await respond();
    if (res.ok) context.waitUntil(cache.put(context.request, res.clone()));
    return res;
}

export function onRequest(context) {
    const path = joinPath(context.params.path);
    const url = new URL(context.request.url);
    if (path === 'tiles') {
        const upstream = drynessTileUpstream(url.searchParams.get('bbox'));
        if (!upstream) return notFound();
        return cached(context, async () => {
            const r = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
            if (!r.ok) return new Response('Upstream unavailable', { status: 502 });
            const png = recolorDryness(new Uint8Array(await r.arrayBuffer()));
            return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${TTL}` } });
        });
    }
    if (path === 'at') {
        const upstream = drynessAtUpstream(url.searchParams.get('lng'), url.searchParams.get('lat'));
        if (!upstream) return json({ percent: null });
        return cached(context, async () => {
            const r = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
            if (!r.ok) return json({ percent: null }, 502);
            return json({ percent: drynessPercent(await r.text()) });
        });
    }
    return notFound();
}
