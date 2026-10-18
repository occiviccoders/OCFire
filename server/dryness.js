// Daily 100-hour dead fuel moisture from gridMET, drawn through its WMS.
// The service paints low moisture blue. We flip that palette so drier ground is red.

const SERVICE = 'https://tds-proxy.nkn.uidaho.edu/thredds/wms/agg_met_fm100_1979_CurrentYear_CONUS.nc';
const MERCATOR = 20037508.35;

// Driest first. Wetter fades toward blue so it sits back under the fire colors.
const RAMP = [
    [0xd7, 0x30, 0x1f],
    [0xff, 0x5a, 0x1f],
    [0xff, 0x9f, 0x1c],
    [0xff, 0xd1, 0x66],
    [0xe6, 0xd3, 0x5a],
    [0x8f, 0xb8, 0xc9],
    [0x4c, 0x78, 0xb0],
];

export function drynessTileUpstream(bbox) {
    const parts = String(bbox || '').split(',');
    if (parts.length !== 4) return null;
    const [w, s, e, n] = parts.map(Number);
    if (![w, s, e, n].every(Number.isFinite) || !(w < e && s < n)) return null;
    if (w < -MERCATOR || s < -MERCATOR || e > MERCATOR || n > MERCATOR) return null;
    if (e - w > 2_500_000 || n - s > 2_500_000) return null;

    const q = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetMap',
        LAYERS: 'dead_fuel_moisture_100hr',
        SRS: 'EPSG:3857',
        BBOX: [w, s, e, n].join(','),
        WIDTH: '256',
        HEIGHT: '256',
        FORMAT: 'image/png',
        TRANSPARENT: 'true',
        STYLES: 'boxfill/redblue',
        COLORSCALERANGE: '6,22',
        NUMCOLORBANDS: '8',
        BELOWMINCOLOR: 'transparent',
        ABOVEMAXCOLOR: 'extend',
        TIME: 'current',
    });
    return `${SERVICE}?${q}`;
}

export function drynessAtUpstream(lng, lat) {
    const x = Number(lng);
    const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < -125 || x > -66 || y < 24 || y > 50) return null;
    const d = 0.04;
    const q = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetFeatureInfo',
        LAYERS: 'dead_fuel_moisture_100hr',
        QUERY_LAYERS: 'dead_fuel_moisture_100hr',
        SRS: 'EPSG:4326',
        BBOX: [x - d, y - d, x + d, y + d].join(','),
        WIDTH: '101',
        HEIGHT: '101',
        X: '50',
        Y: '50',
        INFO_FORMAT: 'text/xml',
        TIME: 'current',
    });
    return `${SERVICE}?${q}`;
}

export function drynessPercent(xml) {
    const match = String(xml || '').match(/<value>([^<]+)<\/value>/);
    const percent = match ? Number(match[1]) : NaN;
    return Number.isFinite(percent) ? Math.round(percent * 10) / 10 : null;
}

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c ^= bytes[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
}

function setU32(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 255;
    bytes[offset + 1] = (value >>> 16) & 255;
    bytes[offset + 2] = (value >>> 8) & 255;
    bytes[offset + 3] = value & 255;
}

// The first two palette slots are the transparent nodata color. The rest run dry to wet.
export function recolorDryness(png) {
    const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (type === 'PLTE' && length % 3 === 0) {
            const count = length / 3;
            const next = bytes.slice(offset + 8, offset + 8 + length);
            const usable = Math.max(1, count - 2);
            for (let i = 2; i < count; i++) {
                const pos = ((i - 2) / Math.max(1, usable - 1)) * (RAMP.length - 1);
                const a = Math.floor(pos);
                const b = Math.min(RAMP.length - 1, a + 1);
                const f = pos - a;
                const o = i * 3;
                for (let channel = 0; channel < 3; channel++) {
                    next[o + channel] = Math.round(RAMP[a][channel] * (1 - f) + RAMP[b][channel] * f);
                }
            }
            const out = bytes.slice();
            out.set(next, offset + 8);
            const signed = new Uint8Array(4 + length);
            signed.set(bytes.subarray(offset + 4, offset + 8), 0);
            signed.set(next, 4);
            setU32(out, offset + 8 + length, crc32(signed));
            return out;
        }
        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return bytes;
}
