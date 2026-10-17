// Satellite card for a named fire: dimmed imagery, red wind arrows, satellite heat, and a map button.
import { FONT_B64 } from './font.js';

const W = 1080;
const H = 1350;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
const FIRIS = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/CA_Perimeters_NIFC_FIRIS_public_view/FeatureServer/0/query';
const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const keyOf = (name) => (name || '').toLowerCase().replace(/\bfire\b/g, '').replace(/[^a-z0-9]/g, '');
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const MERC = 20037508.34;
const mercX = (lng) => (lng * MERC) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (MERC / Math.PI);
const unMercX = (x) => (x * 180) / MERC;
const unMercY = (y) => (Math.atan(Math.sinh((y * Math.PI) / MERC)) * 180) / Math.PI;
const FIRMS = 'https://firewatch.occiviccoders.com/api/firms';

function acresText(acres) {
    if (acres == null || acres === '' || Number.isNaN(Number(acres))) return 'size not yet reported';
    const n = Number(acres);
    return `${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 })} acres`;
}

function fontBytes() {
    const bin = atob(FONT_B64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

let wasmReady;
async function resvg(svg, wasm) {
    if (!wasmReady) {
        const { initWasm } = await import('@resvg/resvg-wasm');
        wasmReady = initWasm(wasm);
    }
    await wasmReady;
    const { Resvg } = await import('@resvg/resvg-wasm');
    const renderer = new Resvg(svg, {
        font: { fontBuffers: [fontBytes()], defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', loadSystemFonts: false },
        fitTo: { mode: 'width', value: W },
        shapeRendering: 2,
        textRendering: 1,
    });
    const image = renderer.render();
    const { encode } = await import('jpeg-js');
    const jpg = encode({ data: image.pixels, width: image.width, height: image.height }, 78);
    image.free();
    renderer.free();
    return jpg.data;
}

async function liveFacts(fire) {
    try {
        const res = await fetch('https://incidents.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false', { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return fire;
        const data = await res.json();
        const hit = (data.features || []).find((f) => keyOf(f.properties?.Name) === keyOf(fire.name));
        if (!hit?.geometry) return fire;
        return {
            ...fire,
            name: (hit.properties.Name || fire.name).trim(),
            acres: hit.properties.AcresBurned,
            contained: hit.properties.PercentContained,
            county: hit.properties.County || fire.county,
            lng: hit.geometry.coordinates[0],
            lat: hit.geometry.coordinates[1],
        };
    } catch {
        return fire;
    }
}

function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates.map((ring) => ring);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap((poly) => poly);
    return [];
}

async function perimeter(name) {
    const wanted = keyOf(name);
    const queries = [
        [FIRIS, `UPPER(incident_name) LIKE '%${name.toUpperCase().replace(/'/g, '')}%'`],
        [WFIGS, `UPPER(poly_IncidentName) LIKE '%${name.toUpperCase().replace(/\s*FIRE\s*$/i, '').replace(/'/g, '')}%' AND attr_POOState='US-CA'`],
    ];
    for (const [url, where] of queries) {
        try {
            const q = new URLSearchParams({ where, outFields: 'incident_name,poly_IncidentName,attr_IncidentName', geometryPrecision: '4', f: 'geojson' });
            const res = await fetch(`${url}?${q}`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const data = await res.json();
            const hit = (data.features || []).find((f) => {
                const label = f.properties?.incident_name || f.properties?.poly_IncidentName || f.properties?.attr_IncidentName || '';
                return keyOf(label) === wanted;
            });
            if (hit) return ringsOf(hit.geometry);
        } catch {
            // The other feed may still have it.
        }
    }
    return [];
}

async function windAt(lat, lng) {
    const q = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
        wind_speed_unit: 'mph',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    if (!c) return null;
    return { speed: Math.round(c.wind_speed_10m), gust: Math.round(c.wind_gusts_10m), from: compass(c.wind_direction_10m), dir: c.wind_direction_10m };
}

function frame(rings, lng, lat) {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    const add = (x, y) => {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
    };
    const pts = rings.flat();
    if (pts.length) pts.forEach(([lo, la]) => add(mercX(lo), mercY(la)));
    else add(mercX(lng), mercY(lat));
    const minSpan = 7200;
    if (e - w < minSpan) {
        const cx = (w + e) / 2;
        w = cx - minSpan / 2;
        e = cx + minSpan / 2;
    }
    if (n - s < minSpan) {
        const cy = (s + n) / 2;
        s = cy - minSpan / 2;
        n = cy + minSpan / 2;
    }
    const padX = (e - w) * 0.22;
    const padY = (n - s) * 0.22;
    w -= padX;
    e += padX;
    s -= padY * 1.15;
    n += padY * 0.45;
    const aspect = W / H;
    const bw = e - w;
    const bh = n - s;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const width = bw / bh > aspect ? bw : bh * aspect;
    const height = width / aspect;
    return { w: cx - width / 2, e: cx + width / 2, s: cy - height / 2, n: cy + height / 2 };
}

function project(lng, lat, box) {
    const x = ((mercX(lng) - box.w) / (box.e - box.w)) * W;
    const y = ((box.n - mercY(lat)) / (box.n - box.s)) * H;
    return [x, y];
}

function arrow(cx, cy, dir, scale, wobble) {
    const blow = (dir + 180 + wobble) % 360;
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${blow.toFixed(1)}) scale(${scale})">
        <path d="M0 -52 L20 -14 L8 -16 L8 38 L-8 38 L-8 -16 L-20 -14 Z" fill="#ff1a1a" stroke="#1a0505" stroke-width="7" stroke-linejoin="round"/>
    </g>`;
}

function parseCsv(text) {
    const [head, ...lines] = text.trim().split('\n');
    if (!head?.startsWith('latitude')) return [];
    const cols = head.split(',');
    return lines.filter(Boolean).map((line) => Object.fromEntries(line.split(',').map((cell, i) => [cols[i], cell])));
}

async function heatIn(box) {
    const bbox = [unMercX(box.w), unMercY(box.s), unMercX(box.e), unMercY(box.n)].map((n) => n.toFixed(3)).join(',');
    const sensors = ['GOES_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'];
    const rows = (await Promise.all(sensors.map(async (sensor) => {
        try {
            const res = await fetch(`${FIRMS}/${sensor}/${bbox}/1`, { signal: AbortSignal.timeout(12000) });
            if (!res.ok) return [];
            return parseCsv(await res.text()).map((r) => ({ ...r, goes: sensor.startsWith('GOES') }));
        } catch {
            return [];
        }
    }))).flat();
    const goes = new Map();
    const viirs = [];
    for (const r of rows) {
        const lat = Number(r.latitude);
        const lng = Number(r.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const stamp = `${r.acq_date || ''} ${r.acq_time || ''}`;
        if (r.goes) {
            const key = `${Math.round(lat / 0.02)}:${Math.round(lng / 0.02)}`;
            const prev = goes.get(key);
            if (!prev || stamp > prev.stamp) goes.set(key, { lat, lng, stamp });
        } else viirs.push({ lat, lng, frp: Number(r.frp) || 0 });
    }
    return { goes: [...goes.values()].slice(0, 40), viirs: viirs.slice(0, 120) };
}

function cardSvg(fire, rings, wind, heat, jpegB64, box) {
    const polys = rings.map((ring) => {
        const step = Math.max(1, Math.floor(ring.length / 200));
        const pts = [];
        for (let i = 0; i < ring.length; i += step) pts.push(project(ring[i][0], ring[i][1], box));
        pts.push(project(ring[0][0], ring[0][1], box));
        return `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="rgba(255,59,31,0.45)" stroke="#ffd166" stroke-width="4"/>`;
    }).join('');
    const [ox, oy] = project(Number(fire.lng), Number(fire.lat), box);
    const spots = [[0.24, 0.3, 1.15, -8], [0.7, 0.24, 0.92, 6], [0.42, 0.5, 1.28, 4], [0.74, 0.52, 0.86, -11], [0.28, 0.66, 1.05, 7]];
    const arrows = wind ? spots.map(([fx, fy, scale, wobble]) => arrow(W * fx, H * fy, wind.dir, scale, wobble)) : [];
    const goesSvg = (heat?.goes || []).map((g) => {
        const [x, y] = project(g.lng, g.lat, box);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="34" fill="rgba(255,110,20,0.22)" stroke="#ff8a1a" stroke-width="3"/>`;
    }).join('');
    const viirsSvg = (heat?.viirs || []).map((g) => {
        const [x, y] = project(g.lng, g.lat, box);
        const core = g.frp >= 50 ? '#ff2a00' : g.frp >= 10 ? '#ff5a00' : '#ffb000';
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="rgba(255,70,0,0.55)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${core}" stroke="#fff2dc" stroke-width="1.5"/>`;
    }).join('');
    const where = fire.county ? `${fire.county} County` : 'California';
    const contained = fire.contained == null || fire.contained === '' ? 'containment not yet reported' : `${Math.round(Number(fire.contained))}% contained`;
    const windLine = wind ? `Wind ${wind.speed} mph from the ${wind.from}, gusts ${wind.gust}  ·  Per CAL FIRE` : 'Per CAL FIRE';
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <image href="data:image/jpeg;base64,${jpegB64}" width="${W}" height="${H}" preserveAspectRatio="none"/>
  <rect width="${W}" height="${H}" fill="#0b0d10" opacity="0.34"/>
  ${polys}
  ${goesSvg}
  ${viirsSvg}
  <circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="8" fill="#fff" stroke="#ff3b1f" stroke-width="3"/>
  ${arrows.join('')}
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0d0f12"/><stop offset="1" stop-color="#0d0f12" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0d0f12" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#0d0f12" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#0d0f12"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="170" fill="url(#top)"/>
  <rect x="0" y="1000" width="${W}" height="350" fill="url(#bottom)"/>
  <circle cx="58" cy="62" r="12" fill="#ff3b1f"/>
  <text x="84" y="58" fill="#e8eaed" font-family="Inter, sans-serif" font-size="28" font-weight="600" letter-spacing="3">CALIFORNIA FIRE WATCH</text>
  <text x="84" y="90" fill="#9aa3ad" font-family="Inter, sans-serif" font-size="22" font-weight="600" letter-spacing="2">UNOFFICIAL</text>
  <text x="56" y="1072" fill="#ffd166" font-family="Inter, sans-serif" font-size="22" font-weight="600" letter-spacing="3">${xml(where.toUpperCase())}</text>
  <text x="56" y="1132" fill="#e8eaed" font-family="Inter, sans-serif" font-size="56" font-weight="600">${xml(fire.name)}</text>
  <text x="56" y="1176" fill="#e8eaed" font-family="Inter, sans-serif" font-size="26" font-weight="600">${xml(`${acresText(fire.acres)}  ·  ${contained}`)}</text>
  <text x="56" y="1210" fill="#c5d4ee" font-family="Inter, sans-serif" font-size="22" font-weight="600">${xml(windLine)}</text>
  <rect x="40" y="1240" width="1000" height="84" rx="18" fill="#ff5a00"/>
  <text x="540" y="1294" text-anchor="middle" fill="#1a0a00" font-family="Inter, sans-serif" font-size="42" font-weight="700">See the latest interactive map</text>
</svg>`;
}

export async function renderCard(fire, wasm) {
    const facts = await liveFacts(fire);
    const lat = Number(facts.lat);
    const lng = Number(facts.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Fire location is missing');
    const rings = await perimeter(facts.name);
    const box = frame(rings, lng, lat);
    const q = new URLSearchParams({
        bbox: `${box.w},${box.s},${box.e},${box.n}`,
        bboxSR: '102100',
        imageSR: '102100',
        size: `${W},${H}`,
        format: 'jpg',
        f: 'image',
    });
    const [shot, wind, heat] = await Promise.all([
        fetch(`${ESRI}?${q}`, { signal: AbortSignal.timeout(12000) }),
        windAt(lat, lng),
        heatIn(box),
    ]);
    if (!shot.ok) throw new Error(`Satellite image ${shot.status}`);
    const bytes = new Uint8Array(await shot.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    const svg = cardSvg({ ...facts, lat, lng }, rings, wind, heat, btoa(binary), box);
    return resvg(svg, wasm);
}

export function cardUrl(fire) {
    const q = new URLSearchParams({
        name: fire.name,
        lat: String(fire.lat),
        lng: String(fire.lng),
        acres: fire.acres == null ? '' : String(fire.acres),
        contained: fire.contained == null ? '' : String(fire.contained),
        county: fire.county || '',
    });
    return `https://ocfire-collector.initial-apps.workers.dev/api/card.jpg?${q}`;
}
