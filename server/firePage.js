// One HTML document per open named fire, served at /fires/<slug> by a Pages Function.
// Facts come from the CAL FIRE incident API. The picture is an Esri satellite export.
// Wind is one Open-Meteo reading. Nothing here needs the Vite app or a browser.

const SITE = 'https://firewatch.occiviccoders.com';
const FEED = 'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false';
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

const named = (name) => /\b(fire|complex)$/i.test((name || '').trim());
export const fireSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function acresText(acres) {
    if (acres == null || Number.isNaN(Number(acres))) return 'size not yet reported';
    return `${Number(acres).toLocaleString('en-US', { maximumFractionDigits: acres < 10 ? 1 : 0 })} acres`;
}

function when(value) {
    if (!value) return '';
    const ms = typeof value === 'string' && value.includes('/Date(') ? Number(value.replace(/[^\d]/g, '')) : Date.parse(value);
    if (!Number.isFinite(ms)) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

let cache = { at: 0, fires: [] };

async function openFires() {
    if (Date.now() - cache.at < 60_000) return cache.fires;
    const res = await fetch(FEED);
    if (!res.ok) throw new Error(`CAL FIRE ${res.status}`);
    const data = await res.json();
    const fires = (data.features || [])
        .filter((f) => f.properties?.IsActive && f.geometry && named(f.properties.Name))
        .map((f) => {
            const p = f.properties;
            return {
                slug: fireSlug(p.Name.trim()),
                name: p.Name.trim(),
                acres: p.AcresBurned,
                contained: p.PercentContained,
                county: p.County || '',
                location: (p.Location || '').trim(),
                updated: p.Updated,
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
            };
        });
    cache = { at: Date.now(), fires };
    return fires;
}

function satelliteUrl(lat, lng) {
    const span = 0.1;
    const q = new URLSearchParams({
        bbox: [lng - span, lat - span * 0.7, lng + span, lat + span * 0.7].join(','),
        bboxSR: '4326',
        imageSR: '4326',
        size: '1200,720',
        format: 'jpg',
        f: 'image',
    });
    return `${IMAGERY}?${q}`;
}

const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

async function windText(lat, lng) {
    try {
        const q = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lng),
            current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
            wind_speed_unit: 'mph',
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return '';
        const current = (await res.json()).current;
        if (!current) return '';
        return `Wind ${Math.round(current.wind_speed_10m)} mph from the ${compass(current.wind_direction_10m)}, gusts ${Math.round(current.wind_gusts_10m)}.`;
    } catch {
        return '';
    }
}

async function page(fire) {
    const where = fire.county ? `${fire.county} County` : 'California';
    const contained = fire.contained == null ? 'containment not yet reported' : `${Math.round(fire.contained)}% contained`;
    const updated = when(fire.updated);
    const wind = await windText(fire.lat, fire.lng);
    const description = `${fire.name} in ${where}: ${acresText(fire.acres)}, ${contained}, per CAL FIRE. Unofficial. Not an evacuation source.`;
    const url = `${SITE}/fires/${fire.slug}`;
    const mapUrl = `${SITE}/?at=${fire.lat.toFixed(4)},${fire.lng.toFixed(4)}&zoom=11&label=${encodeURIComponent(fire.name)}`;
    const image = satelliteUrl(fire.lat, fire.lng);
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${e(fire.name)} — ${e(where)} | California Fire Watch</title>
    <meta name="description" content="${e(description)}">
    <link rel="canonical" href="${e(url)}">
    <meta property="og:title" content="${e(fire.name)} — ${e(where)}">
    <meta property="og:description" content="${e(description)}">
    <meta property="og:url" content="${e(url)}">
    <meta property="og:type" content="website">
    <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: fire.name,
        description,
        url,
        dateModified: updated || undefined,
        isBasedOn: 'https://www.fire.ca.gov/incidents',
    })}</script>
    <style>
        body { margin: 0; background: #0d0f12; color: #e8eaed; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.2rem 3rem; }
        a { color: #ffd166; }
        .brand { color: #9aa3ad; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.78rem; }
        h1 { font-size: 2.4rem; line-height: 1.05; margin: 0.4rem 0; }
        .facts { font-size: 1.15rem; }
        .where { color: #ffd166; margin: 0; }
        .scene { margin: 1rem 0; border-radius: 0.8rem; overflow: hidden; background: #15181d; }
        .scene img { display: block; width: 100%; height: auto; }
        .note { color: #9aa3ad; font-size: 0.92rem; }
    </style>
</head>
<body>
    <main>
        <p class="brand"><a href="/">California Fire Watch</a> · unofficial</p>
        <p class="where">${e(where)}</p>
        <h1>${e(fire.name)}</h1>
        <p class="facts">${e(acresText(fire.acres))} · ${e(contained)}${updated ? ` · updated ${e(updated)} PT` : ''}</p>
        ${wind ? `<p class="facts">${e(wind)}</p>` : ''}
        ${fire.location ? `<p>${e(fire.location)}</p>` : ''}
        <figure class="scene">
            <img src="${e(image)}" alt="Satellite view near ${e(fire.name)}" width="1200" height="720">
        </figure>
        <p><a href="${e(mapUrl)}">Open on the live map</a> for smoke, fuel, and nearby fires.</p>
        <p class="note">Information only, from the CAL FIRE incident list, an Esri satellite image, and a weather model. Not an official alert or evacuation source. Orders come from local fire and law enforcement.</p>
    </main>
</body>
</html>`;
}

export async function firePageHtml(slug) {
    const fire = (await openFires()).find((f) => f.slug === slug);
    return fire ? page(fire) : null;
}

export async function fireIndexHtml() {
    const fires = (await openFires()).filter((f) => f.contained == null || f.contained < 100);
    const items = fires
        .sort((a, b) => (b.acres || 0) - (a.acres || 0))
        .map((f) => `<li><a href="/fires/${e(f.slug)}">${e(f.name)}</a> — ${e(f.county || 'California')} · ${e(acresText(f.acres))}</li>`)
        .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Open fires | California Fire Watch</title>
    <meta name="description" content="Named California fires that are still open, with a page for each.">
    <style>
        body { margin: 0; background: #0d0f12; color: #e8eaed; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1.2rem 3rem; }
        a { color: #ffd166; }
    </style>
</head>
<body>
    <main>
        <p><a href="/">California Fire Watch</a></p>
        <h1>Open fires</h1>
        <p>Each fire has its own page, which is the address a search engine can keep.</p>
        <ul>${items}</ul>
    </main>
</body>
</html>`;
}

export async function sitemapXml() {
    const fires = await openFires();
    const urls = [
        `  <url><loc>${SITE}/</loc></url>`,
        `  <url><loc>${SITE}/fires</loc></url>`,
        ...fires.map((f) => `  <url><loc>${SITE}/fires/${f.slug}</loc></url>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
