import { fireIndexHtml } from '../../server/firePage.js';

const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' };

export async function onRequest() {
    return new Response(await fireIndexHtml(), { headers });
}
