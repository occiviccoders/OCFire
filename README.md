# California Fire Watch

Local wildfire situational-awareness map for Orange County and Southern California.

## Run

```bash
npm install
cp .env.example .env.local   # add a free NASA FIRMS key to enable satellite hotspots
npm run dev
```

CAL FIRE, NASA FIRMS, CHP and NOAA HMS don't allow cross-origin requests, so they're proxied by the Vite dev
server (`vite.config.js`). Use `npm run dev` or `npm run preview`; opening `index.html` directly won't work.

## Deploy (Cloudflare Pages)

In production the same `/api/*` routes are served by Cloudflare Pages Functions (`functions/api/`, shared
code in `server/proxy.js`). They only accept the URL shapes the app uses and cache responses at the edge
(CHP 1 min, CAL FIRE 2 min, FIRMS 5 min, smoke 10 min), so all visitors share one upstream fetch.

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `occiviccoders/OCFire`.
2. Build command `npm run build`, output directory `dist` (also set in `wrangler.toml`).
3. Settings → Variables and Secrets → add `FIRMS_MAP_KEY` as a secret (Production and Preview).
4. Custom domains → add e.g. `fire.occiviccoders.com` (the zone must be in the same Cloudflare account).

Test the production setup locally: `npm run build && npx wrangler pages dev dist` (reads the key from `.dev.vars`).


## Data sources

| Layer | Source | Refresh |
| --- | --- | --- |
| Incidents (points, containment) | CAL FIRE incident feed | 5 min, paused while hidden |
| Fire perimeters | CAL FIRE FIRIS intel-flight perimeters + NIFC WFIGS (ArcGIS Feature Services) | 5 min, paused while hidden |
| Satellite hotspots (24h) | NASA FIRMS — VIIRS (NOAA-20/21, S-NPP) + MODIS | 5 min, paused while hidden |
| Unconfirmed heat (possible new fires) | FIRMS hotspots from the last 12h that aren't near any incident or perimeter; 5-day VIIRS history marks recurring industrial heat as "persistent" | 5 min (history 3h) |
| Red flag warnings / fire weather watches | NWS `api.weather.gov` alerts + fire-weather zones | 5 min, paused while hidden |
| Wind flow, arrows, Hot-Dry-Windy index, wind at each fire | Open-Meteo hourly forecast, statewide 0.35° grid masked to California (~500 points, cached in localStorage) | 3 h, paused while the tab is hidden |
| Fire-weather outlook for OC + known wind corridors (Santa Ana, Sundowner, Diablo, North) | Open-Meteo point forecasts | 3 h, paused while the tab is hidden |
| Air quality (AQI, PM2.5) | Open-Meteo air-quality API | 60 min |
| Smoke plumes | NOAA HMS satellite smoke analysis (KML, proxied) | 5 min when on |
| Fire Hazard Severity Zones | CAL FIRE FHSZ (2024 maps, ArcGIS Feature Service), loaded at zoom 9+ | on map move |
| Power shutoffs / outages | SCE PSPS areas + Cal OES statewide outage feed | 5 min when on |
| Fire cameras near each incident | ALERTCalifornia camera list + latest frames | on load |
| Evacuation route planner: driving routes | Valhalla public demo server (FOSSGIS), 8 compass directions + alternates | on demand |
| Evacuation planner: address search / place names | Photon (Komoot) geocoder | on demand |
| Evacuation planner: road closures, SigAlerts, crashes, flooding | CHP live incident feed (`media.chp.ca.gov/sa_xml/sa.xml`, proxied) | 2 min while planning |
| Get ready: address check, checklists | FHSZ, AQI, outages, incidents above; guidance from CAL FIRE Ready, Set, Go! and OCFA. Progress saved in localStorage | on demand |
| Basemap | CARTO Dark Matter; Esri World Imagery (satellite toggle) | — |

Informational only. For evacuations follow [Genasys Protect](https://protect.genasys.com) and official alerts.
