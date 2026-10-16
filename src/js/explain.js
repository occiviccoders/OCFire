import { formatAcres, formatMiles, timeAgo } from './util.js';

const STOPS = [
    [0, [255, 59, 31]],
    [60, [255, 159, 28]],
    [99, [255, 209, 102]],
    [100, [139, 149, 161]],
];

// Same ramp as the map layers and legend.
export function containmentColor(pct) {
    if (pct == null) return 'rgb(154, 163, 173)';
    const p = Math.max(0, Math.min(100, pct));
    for (let i = 1; i < STOPS.length; i++) {
        const [p1, c1] = STOPS[i];
        const [p0, c0] = STOPS[i - 1];
        if (p <= p1) {
            const t = (p - p0) / (p1 - p0 || 1);
            return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
        }
    }
    return `rgb(${STOPS.at(-1)[1].join(',')})`;
}

export function containmentStage(pct) {
    if (pct == null) return { label: 'Containment not reported', detail: 'The agency hasn’t published a containment figure yet.' };
    if (pct >= 100) return { label: 'Fully contained', detail: 'Crews have a control line around the entire fire. It isn’t expected to spread, though it may still smolder inside the lines.' };
    if (pct >= 90) return { label: 'Nearly contained', detail: 'Almost the whole edge is lined. Crews are mostly mopping up hot spots.' };
    if (pct >= 60) return { label: 'Mostly contained', detail: 'Most of the edge is secured, but open sections could still spread in wind.' };
    if (pct >= 25) return { label: 'Partially contained', detail: 'Crews hold part of the edge. Large stretches are still open and the fire can grow.' };
    return { label: 'Actively spreading', detail: 'Little or no control line yet. Expect the size and perimeter to keep changing.' };
}

// Rough, familiar yardsticks for acreage.
export function sizeComparison(acres) {
    if (!acres || acres < 1) return null;
    if (acres < 60) return `about ${Math.max(1, Math.round(acres / 1.32))} football field${acres < 2 ? '' : 's'}`;
    if (acres < 5000) {
        const n = acres / 500;
        return n < 1.5 ? 'about the size of the Disneyland Resort' : `about ${Math.round(n)}× the Disneyland Resort`;
    }
    const pct = (acres / 42000) * 100;
    return pct < 100 ? `about ${Math.round(pct)}% the area of Irvine` : `about ${(acres / 42000).toFixed(1)}× the area of Irvine`;
}

export function summarize(p) {
    const name = /fire$/i.test(p.name) ? `The ${p.name}` : `The ${p.name} fire`;
    const where = p.location ? ` near ${p.location.replace(/\s*,\s*$/, '')}` : p.county ? ` in ${p.county} County` : '';
    const comparison = sizeComparison(p.acres);
    const stage = containmentStage(p.contained);
    const who = p.source || 'CAL FIRE';
    const bits = [];
    if (p.started) bits.push(`It started ${timeAgo(p.started)}`);
    if (p.updated) bits.push(`${who} last updated it ${timeAgo(p.updated)}`);
    return [
        `${name} has burned ${formatAcres(p.acres).replace(' ac', ' acres')}${comparison ? ` (${comparison})` : ''}${where}, ${formatMiles(p.distance)} from central OC.`,
        `${stage.label}${p.contained != null ? ` at ${Math.round(p.contained)}%` : ''}: ${stage.detail}`,
        bits.length ? `${bits.join('; ')}.` : '',
    ];
}
