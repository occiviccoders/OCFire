const KM_PER_MI = 1.609344;
const EARTH_KM = 6371;

export const miToKm = (mi) => mi * KM_PER_MI;
export const kmToMi = (km) => km / KM_PER_MI;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Local equirectangular projection (km) around an origin; accurate enough within ~100 km.
export function projector([lng0, lat0]) {
    const kx = 111.32 * Math.cos(toRad(lat0));
    const ky = 110.57;
    return ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky];
}

export function bearing([lng1, lat1], [lng2, lat2]) {
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destination([lng, lat], bearingDeg, km) {
    const d = km / EARTH_KM;
    const b = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lng2 = toRad(lng) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [toDeg(lng2), toDeg(lat2)];
}

export function circle(center, km, steps = 48) {
    const ring = Array.from({ length: steps }, (_, i) => destination(center, (i * 360) / steps, km));
    ring.push(ring[0]);
    return ring;
}

// Wedge from `center` opening toward `bearingDeg`.
export function cone(center, bearingDeg, km, halfAngle = 30, steps = 12) {
    const ring = [center];
    for (let i = 0; i <= steps; i++) ring.push(destination(center, bearingDeg - halfAngle + (2 * halfAngle * i) / steps, km));
    ring.push(center);
    return ring;
}

// Valhalla encodes shapes as polyline with 6 decimal places.
export function decodePolyline6(str) {
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < str.length) {
        for (const axis of [0, 1]) {
            let result = 0;
            let shift = 0;
            let byte;
            do {
                byte = str.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === 0) lat += delta;
            else lng += delta;
        }
        coords.push([lng / 1e6, lat / 1e6]);
    }
    return coords;
}

export function distToSegment([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function inRingXY([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// Points every ~stepKm along a projected line.
export function resample(xyLine, stepKm = 0.25) {
    const out = [xyLine[0]];
    for (let i = 1; i < xyLine.length; i++) {
        const [ax, ay] = xyLine[i - 1];
        const [bx, by] = xyLine[i];
        const len = Math.hypot(bx - ax, by - ay);
        const n = Math.floor(len / stepKm);
        for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / (n + 1), ay + ((by - ay) * k) / (n + 1)]);
        out.push([bx, by]);
    }
    return out;
}

export function lineLengthKm(xyLine) {
    let km = 0;
    for (let i = 1; i < xyLine.length; i++) km += Math.hypot(xyLine[i][0] - xyLine[i - 1][0], xyLine[i][1] - xyLine[i - 1][1]);
    return km;
}

export function polygonsOf(geometry) {
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
}
