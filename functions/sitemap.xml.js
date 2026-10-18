import { sitemapXml } from '../server/firePage.js';

export async function onRequest() {
    return new Response(await sitemapXml(), {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
}
