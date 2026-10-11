import { OC_CENTER } from './config.js';

export const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export function featureCollection(features) {
    return { type: 'FeatureCollection', features };
}

export async function fetchJSON(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    const body = await res.json();
    // ArcGIS reports errors with HTTP 200 and an `error` body.
    if (body && body.error) throw new Error(body.error.message || 'Service error');
    return body;
}

export function distanceMiles([lon1, lat1], [lon2, lat2] = OC_CENTER) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

export function bboxOf(geometry) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === 'number') {
            w = Math.min(w, c[0]); e = Math.max(e, c[0]);
            s = Math.min(s, c[1]); n = Math.max(n, c[1]);
        } else c.forEach(walk);
    };
    walk(geometry.coordinates);
    return [[w, s], [e, n]];
}

export function normalizeName(name) {
    return (name || '').toLowerCase().replace(/\bfire\b/g, '').replace(/[^a-z0-9]/g, '');
}

export function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatAcres(acres) {
    if (acres == null || Number.isNaN(acres)) return '— ac';
    if (acres > 0 && acres < 1) return '<1 ac';
    return `${numberFmt.format(acres)} ac`;
}

export function formatPercent(pct) {
    return pct == null ? 'Unknown' : `${Math.round(pct)}%`;
}

export function formatMiles(mi) {
    return `${numberFmt.format(mi)} mi`;
}

export function timeAgo(date) {
    if (!date) return 'unknown';
    const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (Number.isNaN(t)) return 'unknown';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
}

export function formatClock(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
