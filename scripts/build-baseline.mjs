// Builds public/hotspot-baseline.json: how often each ~1 km cell in California had satellite heat over the
// past year. The app uses it to tell a never-before-hot spot from a farm, flare, or landfill that lights up
// every season.
//
// Requests go through the app's own FIRMS proxy so the key never leaves the server:
//   npm run dev          (in another terminal)
//   npm run baseline     (or BASE=https://your-site npm run baseline)
//
// Rerun monthly. Takes a few minutes.

import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5188';
const BBOX = '-124.5,32.4,-114.1,42.1';
const DAYS = 365;
const WINDOW = 5; // FIRMS archive requests allow at most 5 days
const CELL = 0.01; // degrees, ~1.1 km
const SATELLITES = [
    ['VIIRS_SNPP_SP', 'VIIRS_SNPP_NRT'],
    ['VIIRS_NOAA20_SP', 'VIIRS_NOAA20_NRT'],
];

const day = (d) => d.toISOString().slice(0, 10);

async function fetchCSV(source, start) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`${BASE}/api/firms/${source}/${BBOX}/${WINDOW}/${start}`, { signal: AbortSignal.timeout(60000) });
            const text = await res.text();
            if (res.ok && text.startsWith('latitude')) return text;
        } catch {
            // timeout or network error; retry
        }
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    throw new Error(`${source} ${start} failed`);
}

function parse(text) {
    const [head, ...lines] = text.trim().split('\n');
    const cols = head.split(',');
    const at = (name) => cols.indexOf(name);
    const [iLat, iLng, iDate, iConf, iType] = ['latitude', 'longitude', 'acq_date', 'confidence', 'type'].map(at);
    return lines.map((l) => {
        const v = l.split(',');
        return { lat: +v[iLat], lng: +v[iLng], date: v[iDate], conf: v[iConf], type: iType >= 0 ? v[iType] : '' };
    });
}

// Standard-processing (SP) archives lag a few months; fall back to near-real-time for recent windows.
async function window(sats, start) {
    for (const source of sats) {
        try {
            const rows = parse(await fetchCSV(source, start));
            if (rows.length || source.endsWith('_NRT')) return rows;
        } catch {
            if (source.endsWith('_NRT')) throw new Error(`no data for ${start}`);
        }
    }
    return [];
}

const cells = new Map(); // "latIdx,lngIdx" -> { days:Set, months:bitmask, static:bool }
// Stop 5 days short of today: the app checks those days live, and live detections mustn't count as their own history.
const end = new Date(Date.now() - 5 * 86400000);
const starts = [];
for (let offset = DAYS; offset > 0; offset -= WINDOW) starts.push(day(new Date(end.getTime() - offset * 86400000)));

let done = 0;
const jobs = starts.flatMap((start) => SATELLITES.map((sats) => ({ start, sats })));
async function worker() {
    while (jobs.length) {
        const { start, sats } = jobs.shift();
        for (const r of await window(sats, start)) {
            if (r.conf === 'l' || r.type === '3') continue; // low confidence, offshore
            const key = `${Math.floor(r.lat / CELL)},${Math.floor(r.lng / CELL)}`;
            let c = cells.get(key);
            if (!c) cells.set(key, (c = { days: new Set(), months: 0, static: false }));
            c.days.add(r.date);
            c.months |= 1 << (Number(r.date.slice(5, 7)) - 1);
            if (r.type === '2') c.static = true; // NASA-flagged static land source (industrial)
        }
        process.stdout.write(`\r${++done}/${starts.length * SATELLITES.length} requests, ${cells.size} cells`);
    }
}
await Promise.all(Array.from({ length: 4 }, worker));

// Flat array of [latIdx, lngIdx, days, monthMask, static] tuples keeps the file small.
const out = [];
for (const [key, c] of cells) {
    const [la, ln] = key.split(',').map(Number);
    out.push(la, ln, c.days.size, c.months, c.static ? 1 : 0);
}
mkdirSync('public', { recursive: true });
writeFileSync('public/hotspot-baseline.json', JSON.stringify({
    from: starts[0],
    to: day(end),
    cell: CELL,
    cells: out,
}));
console.log(`\nWrote public/hotspot-baseline.json: ${cells.size} cells, ${starts[0]} to ${day(end)}`);
