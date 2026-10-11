import { distanceMiles, fetchJSON } from '../util.js';

// ALERTCalifornia (UC San Diego) wildfire camera network: ~1,300 PTZ cameras with live pointing data.
const LIST_URL = 'https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json';
const BASE = 'https://cameras.alertcalifornia.org';
const MAX_MI = 30;

let cameras = null;
let loading = null;

export function loadCameras() {
    loading ??= fetchJSON(LIST_URL)
        .then((data) => {
            cameras = data.features
                .filter((f) => f.geometry.coordinates[0] != null && f.properties.state === 'CA')
                .map((f) => ({
                    id: f.properties.id,
                    name: f.properties.name || f.properties.id,
                    coords: f.geometry.coordinates.slice(0, 2),
                    fov: [f.properties.fov_lft, f.properties.fov_rt],
                    lastFrame: f.properties.last_frame_ts,
                }));
            return cameras;
        })
        .catch((err) => {
            cameras = [];
            loading = null;
            throw err;
        });
    return loading;
}

function cross([ax, ay], [bx, by], [cx, cy]) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Is the point inside the triangle the camera is currently looking through?
function inView(cam, p) {
    const [l, r] = cam.fov;
    if (!l?.[0] || !r?.[0]) return false;
    const d1 = cross(cam.coords, l, p);
    const d2 = cross(l, r, p);
    const d3 = cross(r, cam.coords, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Up to `count` nearby cameras, ones currently pointed at the fire first. Null until the list loads.
export function camerasNear(coords, count = 3) {
    if (!cameras) return null;
    return cameras
        .map((c) => ({ ...c, miles: distanceMiles(c.coords, coords), pointed: inView(c, coords) }))
        .filter((c) => c.miles <= MAX_MI)
        .sort((a, b) => Number(b.pointed) - Number(a.pointed) || a.miles - b.miles)
        .slice(0, count)
        .map((c) => ({
            ...c,
            thumb: `${BASE}/public-camera-data/${c.id}/latest-thumb.jpg?t=${c.lastFrame}`,
            frame: `${BASE}/public-camera-data/${c.id}/latest-frame.jpg?t=${c.lastFrame}`,
            page: `${BASE}/?id=${encodeURIComponent(c.id)}`,
        }));
}
