import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const firmsKey = env.FIRMS_MAP_KEY || '';

    // CAL FIRE, NASA FIRMS, CHP and NOAA HMS don't send CORS headers, so the dev/preview
    // server proxies them. The FIRMS key is injected here and never reaches the browser bundle.
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
        '/api/chp': {
            target: 'https://media.chp.ca.gov',
            changeOrigin: true,
            rewrite: () => '/sa_xml/sa.xml',
        },
    };

    return {
        define: {
            // On Cloudflare Pages (CF_PAGES is set in its build) the key lives in the Functions env instead.
            __FIRMS_ENABLED__: JSON.stringify(Boolean(firmsKey || env.CF_PAGES)),
        },
        server: { proxy },
        preview: { proxy },
    };
});
