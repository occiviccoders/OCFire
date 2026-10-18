import { defineConfig, loadEnv } from 'vite';
import { landcoverUrl } from './server/landcover.js';
import { fuelAtUpstream, fuelTileUpstream } from './server/fuel.js';
import { drynessAtUpstream, drynessPercent, drynessTileUpstream, recolorDryness } from './server/dryness.js';
import { USER_AGENT } from './server/proxy.js';
import { fireIndexHtml, firePageHtml, sitemapXml } from './server/firePage.js';

// Mirrors SERVICES in functions/api/perimeters/[source].js.
const PERIMETER_SERVICES = {
    firis: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/CA_Perimeters_NIFC_FIRIS_public_view/FeatureServer/0/query',
    wfigs: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query',
    incidents: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query',
};

// Dev-only pages at /fires and /fires/<slug>. The HTML carries the facts; the map script fills in after.
// Dev stand-in for functions/api/fuel. Tiles are recolored upstream; the browser only sends a bbox.
function fuelDevProxy() {
    return {
        name: 'fuel-dev-proxy',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                try {
                    const url = new URL(req.url || '/', 'http://localhost');
                    let upstream = null;
                    if (url.pathname === '/api/fuel/tiles') upstream = fuelTileUpstream(url.searchParams.get('bbox'));
                    else if (url.pathname === '/api/fuel/at') upstream = fuelAtUpstream(url.searchParams.get('lng'), url.searchParams.get('lat'));
                    else if (url.pathname === '/api/dryness/tiles' || url.pathname === '/api/dryness/at') return drynessDev(url, res);
                    else return next();
                    if (!upstream) {
                        res.statusCode = url.pathname.endsWith('/at') ? 200 : 404;
                        res.setHeader('content-type', 'application/json');
                        return res.end(url.pathname.endsWith('/at') ? '{"value":"NoData"}' : 'Not found');
                    }
                    const r = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
                    res.statusCode = r.status;
                    res.setHeader('content-type', r.headers.get('content-type') || 'application/octet-stream');
                    res.setHeader('cache-control', 'public, max-age=86400');
                    res.end(Buffer.from(await r.arrayBuffer()));
                } catch (err) {
                    next(err);
                }
            });
        },
    };
}

async function drynessDev(url, res) {
    const point = url.pathname.endsWith('/at');
    const upstream = point
        ? drynessAtUpstream(url.searchParams.get('lng'), url.searchParams.get('lat'))
        : drynessTileUpstream(url.searchParams.get('bbox'));
    if (!upstream) {
        res.statusCode = point ? 200 : 404;
        res.setHeader('content-type', point ? 'application/json' : 'text/plain');
        return res.end(point ? '{"percent":null}' : 'Not found');
    }
    const r = await fetch(upstream, { headers: { 'User-Agent': USER_AGENT } });
    if (point) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        const percent = r.ok ? drynessPercent(await r.text()) : null;
        return res.end(JSON.stringify({ percent }));
    }
    if (!r.ok) {
        res.statusCode = 502;
        return res.end('Upstream unavailable');
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'public, max-age=10800');
    return res.end(Buffer.from(recolorDryness(new Uint8Array(await r.arrayBuffer()))));
}

function firePagesDev() {
    const send = (res, body, type) => {
        res.setHeader('content-type', type);
        res.end(body);
    };
    return {
        name: 'fire-pages-dev',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                try {
                    const path = (req.url || '').split('?')[0];
                    if (path === '/sitemap.xml') return send(res, await sitemapXml(), 'application/xml');
                    if (path === '/fires' || path === '/fires/') return send(res, await fireIndexHtml(), 'text/html; charset=utf-8');
                    const match = path.match(/^\/fires\/([a-z0-9-]+)\/?$/);
                    if (!match) return next();
                    const html = await firePageHtml(match[1]);
                    if (!html) { res.statusCode = 404; return res.end('No such fire'); }
                    return send(res, html, 'text/html; charset=utf-8');
                } catch (err) {
                    next(err);
                }
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const firmsKey = env.FIRMS_MAP_KEY || '';

    // Local stand-ins for the Cloudflare Pages Functions in /functions/api. CAL FIRE, FIRMS, CHP and
    // NOAA HMS have no CORS headers; NWS and the perimeter services are routed through the server so
    // production can cache them for everyone. The FIRMS key is injected here and never reaches the bundle.
    const proxy = {
        '/api/calfire': {
            target: 'https://incidents.fire.ca.gov',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/calfire/, ''),
        },
        '/api/firms': {
            target: 'https://firms.modaps.eosdis.nasa.gov',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/firms/, `/api/area/csv/${firmsKey}`),
        },
        '/api/hms': {
            target: 'https://satepsanone.nesdis.noaa.gov',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/hms/, '/pub/FIRE/web/HMS/Smoke_Polygons/KML'),
        },
        '/api/nws': {
            target: 'https://api.weather.gov',
            changeOrigin: true,
            headers: { 'User-Agent': 'California Fire Watch (dev)' },
            rewrite: (path) => path.replace(/^\/api\/nws/, ''),
        },
        ...Object.fromEntries(
            Object.entries(PERIMETER_SERVICES).map(([name, url]) => {
                const { origin, pathname } = new URL(url);
                return [`/api/perimeters/${name}`, { target: origin, changeOrigin: true, rewrite: (path) => path.replace(`/api/perimeters/${name}`, pathname) }];
            }),
        ),
        '/api/chp': {
            target: 'https://media.chp.ca.gov',
            changeOrigin: true,
            rewrite: () => '/sa_xml/sa.xml',
        },
        '/api/landcover': {
            target: 'https://www.mrlc.gov',
            changeOrigin: true,
            rewrite: (path) => {
                const url = new URL(landcoverUrl(decodeURIComponent(path.replace(/^\/api\/landcover\//, ''))));
                return url.pathname + url.search;
            },
        },
    };

    return {
        plugins: [fuelDevProxy(), firePagesDev()],
        define: {
            // On Cloudflare Pages (CF_PAGES is set in its build) the key lives in the Functions env instead.
            __FIRMS_ENABLED__: JSON.stringify(Boolean(firmsKey || env.CF_PAGES)),
        },
        build: { rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } } },
        server: { proxy },
        preview: { proxy },
    };
});
