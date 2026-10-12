import { defineConfig, loadEnv } from 'vite';

// Mirrors SERVICES in functions/api/perimeters/[source].js.
const PERIMETER_SERVICES = {
    firis: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/CA_Perimeters_NIFC_FIRIS_public_view/FeatureServer/0/query',
    wfigs: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query',
    incidents: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query',
};

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
    };

    return {
        define: {
            // On Cloudflare Pages (CF_PAGES is set in its build) the key lives in the Functions env instead.
            __FIRMS_ENABLED__: JSON.stringify(Boolean(firmsKey || env.CF_PAGES)),
        },
        build: { rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } } },
        server: { proxy },
        preview: { proxy },
    };
});
