import { cached } from '../util.js';

// One year of satellite heat per ~1 km cell, built by scripts/build-baseline.mjs.
async function loadBaseline() {
    const res = await fetch('/hotspot-baseline.json');
    if (!res.ok) throw new Error(`Baseline: ${res.status}`);
    const { from, to, cell, cells } = await res.json();
    const index = new Map();
    for (let i = 0; i < cells.length; i += 5) {
        index.set(`${cells[i]},${cells[i + 1]}`, { days: cells[i + 2], months: cells[i + 3], static: cells[i + 4] === 1 });
    }
    return { from, to, cell, index };
}

export const fetchBaseline = cached(loadBaseline, 24 * 60 * 60 * 1000);

// History within roughly a kilometer of a point: the busiest neighboring cell, plus every month any of them ran hot.
export function historyAt(baseline, [lng, lat]) {
    if (!baseline) return null;
    const la = Math.floor(lat / baseline.cell);
    const ln = Math.floor(lng / baseline.cell);
    let days = 0;
    let months = 0;
    let isStatic = false;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const c = baseline.index.get(`${la + dy},${ln + dx}`);
            if (!c) continue;
            days = Math.max(days, c.days);
            months |= c.months;
            isStatic ||= c.static;
        }
    }
    return { days, months, static: isStatic, from: baseline.from };
}
