import { fetchJSON, featureCollection } from '../util.js';

// NWS Red Flag Warnings / Fire Weather Watches. Most of these are zone-based with no geometry
// of their own, so the affected fire-weather zone polygons are fetched and cached.
const ALERTS = 'https://api.weather.gov/alerts/active?area=CA&event=Red%20Flag%20Warning,Fire%20Weather%20Watch';
const MAX_ZONES = 80;
const zoneCache = new Map();

function fetchZone(url) {
    if (!zoneCache.has(url)) {
        zoneCache.set(url, fetchJSON(url).catch((err) => {
            zoneCache.delete(url);
            throw err;
        }));
    }
    return zoneCache.get(url);
}

export async function fetchFireWeather() {
    const data = await fetchJSON(ALERTS, { headers: { Accept: 'application/geo+json' } });
    const features = [];
    const pending = [];

    for (const alert of data.features) {
        const p = alert.properties;
        const properties = {
            event: p.event,
            headline: p.headline,
            areaDesc: p.areaDesc,
            onset: p.onset,
            ends: p.ends || p.expires,
            sender: p.senderName,
        };
        if (alert.geometry) {
            features.push({ type: 'Feature', geometry: alert.geometry, properties });
            continue;
        }
        for (const zoneUrl of p.affectedZones || []) {
            if (pending.length >= MAX_ZONES) break;
            pending.push(
                fetchZone(zoneUrl).then((zone) => {
                    if (zone.geometry) features.push({ type: 'Feature', geometry: zone.geometry, properties });
                }),
            );
        }
    }

    await Promise.allSettled(pending);
    return featureCollection(features);
}
