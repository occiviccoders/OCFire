import { escapeHTML as e } from '../util.js';

const LABELS = {
    1: 'Lightning',
    2: 'Equipment use',
    3: 'Smoking',
    4: 'Campfire',
    5: 'Debris burning',
    6: 'Railroad',
    7: 'Arson',
    8: 'Kids with fire',
    9: 'Other / misc.',
    10: 'Vehicle',
    11: 'Power lines',
    12: 'Firefighter training',
    13: 'Other training',
    15: 'Structure fire',
    16: 'Aircraft',
    17: 'Volcanic',
    18: 'Escaped prescribed burn',
    19: 'Illegal campfire',
};
const UNKNOWN = 14;
const NATURAL = new Set([1, 17]);
const MISC = 9;
const SMALL = 0.02;

let data = null;
const view = { years: 10, metric: 'fires' };

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());

function summarize() {
    const from = data.to - view.years + 1;
    const col = view.metric === 'fires' ? 2 : 3;
    const totals = new Map();
    for (const row of data.rows) if (row[0] >= from) totals.set(row[1], (totals.get(row[1]) || 0) + row[col]);
    const unknown = totals.get(UNKNOWN) || 0;
    totals.delete(UNKNOWN);
    const known = [...totals.values()].reduce((a, b) => a + b, 0);
    // Causes under 2% of the known total fold into "Other / misc." so the bars stay readable.
    for (const [code, v] of totals) {
        if (code !== MISC && v < known * SMALL) {
            totals.set(MISC, (totals.get(MISC) || 0) + v);
            totals.delete(code);
        }
    }
    const bars = [...totals].map(([code, v]) => ({ code, label: LABELS[code] || `Cause ${code}`, v })).sort((a, b) => b.v - a.v);
    let run = 0;
    for (const b of bars) b.cum = (run += b.v) / known;
    const human = [...totals].filter(([c]) => !NATURAL.has(c)).reduce((a, [, v]) => a + v, 0);
    return { from, bars, known, unknown, human };
}

function chart({ bars }) {
    const W = 290, H = 220, L = 30, R = 28, T = 10, B = 78;
    const step = (W - L - R) / bars.length;
    const max = Math.max(...bars.map((b) => b.v));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const yPct = (p) => T + (H - T - B) * (1 - p);
    const bx = (i) => L + i * step + step * 0.15;
    const bw = step * 0.7;
    const label = (i, text) => `<text class="causes__xlabel" transform="translate(${bx(i) + bw / 2},${H - B + 8}) rotate(-50)" text-anchor="end">${e(text)}</text>`;
    const line = bars.map((b, i) => `${bx(i) + bw / 2},${yPct(b.cum)}`).join(' ');
    return `
        <svg class="causes__chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pareto chart of wildfire causes">
            <line class="causes__eighty" x1="${L}" x2="${W - R}" y1="${yPct(0.8)}" y2="${yPct(0.8)}"/>
            <text class="causes__axis" x="${W - R + 3}" y="${yPct(0.8) + 3}">80%</text>
            <text class="causes__axis" x="${W - R + 3}" y="${yPct(1) + 3}">100%</text>
            <text class="causes__axis" x="${L - 4}" y="${y(max) + 3}" text-anchor="end">${fmt(max)}</text>
            <text class="causes__axis" x="${L - 4}" y="${y(0) + 3}" text-anchor="end">0</text>
            ${bars.map((b, i) => `
                <rect class="causes__bar${i < 3 ? ' causes__bar--top' : ''}" x="${bx(i)}" y="${y(b.v)}" width="${bw}" height="${y(0) - y(b.v)}">
                    <title>${e(b.label)}: ${b.v.toLocaleString()} ${view.metric === 'fires' ? 'fires' : 'acres'} (${Math.round(b.cum * 100)}% cumulative)</title>
                </rect>
                ${label(i, b.label)}`).join('')}
            <polyline class="causes__cum" points="${line}"/>
            ${bars.map((b, i) => `<circle class="causes__cum-pt" cx="${bx(i) + bw / 2}" cy="${yPct(b.cum)}" r="2.5"/>`).join('')}
        </svg>`;
}

function render(root) {
    const s = summarize();
    const unit = view.metric === 'fires' ? 'fires' : 'acres burned';
    const top3 = s.bars.slice(0, 3);
    const chip = (key, value, text) => `<button class="chip${view[key] === value ? ' is-active' : ''}" data-cause-${key}="${value}">${text}</button>`;
    root.innerHTML = `
        <div class="causes__controls">
            <span>${chip('years', 5, '5 yr')}${chip('years', 10, '10 yr')}${chip('years', 20, '20 yr')}</span>
            <span>${chip('metric', 'fires', 'Fires')}${chip('metric', 'acres', 'Acres')}</span>
        </div>
        ${chart(s)}
        <p class="ready__intro">
            ${s.from}–${data.to}, by ${unit}. Among those with a known cause, <strong>${Math.round((s.human / s.known) * 100)}%</strong> were started by people,
            and the top three (${top3.map((b) => e(b.label.toLowerCase())).join(', ')}) account for <strong>${Math.round(top3.at(-1).cum * 100)}%</strong>.
            Another ${fmt(s.unknown)} ${unit} (${Math.round((s.unknown / (s.known + s.unknown)) * 100)}%) have no cause on record, often because the investigation is still open, and aren’t charted.
        </p>
        <p class="causes__source">CAL FIRE FRAP fire perimeters (updated yearly; includes only fires above CAL FIRE's minimum size, e.g. 10+ acres in timber).</p>`;
}

export function mountCauses(details) {
    const root = details.querySelector('.causes__body');
    details.addEventListener('toggle', async () => {
        if (!details.open || data) return;
        root.innerHTML = '<p class="ready__intro">Loading…</p>';
        try {
            data = await (await fetch('/fire-causes.json')).json();
            render(root);
        } catch {
            root.innerHTML = '<p class="ready__intro">Couldn’t load the cause data.</p>';
        }
    });
    root.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-cause-years], [data-cause-metric]');
        if (!btn || !data) return;
        if (btn.dataset.causeYears) view.years = Number(btn.dataset.causeYears);
        else view.metric = btn.dataset.causeMetric;
        render(root);
    });
}
