import { firePageHtml } from '../../server/firePage.js';

export async function onRequest(context) {
    const html = await firePageHtml(context.params.slug);
    if (!html) return new Response('No such fire', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' },
    });
}
