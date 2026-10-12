import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS } from './config.js';
import { escapeHTML as e } from './util.js';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const HOUR = 3600 * 1000;
const PLAY_MS = 9000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const LEVEL = { high: 'Strong', moderate: 'Moderate', low: 'Weak' };

const STYLE = {
    version: 8,
    sources: {
        imagery: { type: 'raster', tiles: [BASEMAPS.satelliteTiles], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri' },
    },
    layers: [
        { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': 0.75, 'raster-saturation': -0.3 } },
    ],
};

const when = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function offsetLabel(ms) {
    const mins = Math.round(Math.abs(ms) / 60000);
    const span = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${(mins / 1440).toFixed(1)}d`;
    return `${ms < 0 ? '−' : '+'}${span}`;
}

// Replays one track on a small local map: detections appear at their pass time and fade with age, the
// reported incident appears at its discovery time, and the wind/score panel follows the latest snapshot.
// Returns a cleanup function.
export function mountReplay(container, { track, incident, snapshots, detections, events }) {
    const dets = detections.map((d) => ({ ...d, t: Date.parse(d.acquired) }));
    const snaps = snapshots.map((s) => ({ ...s, t: Date.parse(s.pass_time) }));
    // The collector's own timestamps are about this system, not the fire, so they stay out of the replay.
    // Later containment updates can come weeks after the heat; they only show if they fall inside the
    // window set by the detections and the original report.
    const fireEvents = events.filter((ev) => ev.kind !== 'collector').map((ev) => ({ ...ev, t: Date.parse(ev.at) }));
    const start = Math.min(...dets.map((d) => d.t), Date.parse(track.first_seen));
    const firstHeat = Date.parse(track.first_seen);
    const end = Math.max(start + HOUR, ...fireEvents.filter((m) => !m.lifecycle).map((m) => m.t));
    const marks = fireEvents.filter((m) => m.t <= end);
    const t0 = start - 0.03 * (end - start);
    const t1 = end + 0.03 * (end - start);

    container.innerHTML = `
        <div class="lab-replay">
            <div class="lab-replay__map"></div>
            <div class="lab-replay__panel" data-panel></div>
            <div class="lab-replay__clock" data-clock></div>
        </div>
        <div class="lab-replay__controls">
            <button class="lab-btn lab-replay__play" data-play aria-label="Play">▶</button>
            <div class="lab-replay__track">
                <div class="lab-replay__marks">
                    ${marks.map((m) => `<span class="lab-replay__mark lab-replay__mark--${e(m.kind)}" style="left:${(100 * (m.t - t0)) / (t1 - t0)}%" title="${e(m.title)}"></span>`).join('')}
                </div>
                <input type="range" min="0" max="1000" value="1000" step="1" data-slider aria-label="Time">
            </div>
        </div>
        <p class="lab-replay__caption" data-caption></p>`;

    const $ = (sel) => container.querySelector(sel);
    const slider = $('[data-slider]');
    const map = new maplibregl.Map({
        container: $('.lab-replay__map'),
        style: STYLE,
        center: [track.lng, track.lat],
        zoom: 12,
        attributionControl: { compact: true },
        cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const points = [...dets.map((d) => [d.lng, d.lat]), ...(incident?.lng != null ? [[incident.lng, incident.lat]] : [])];
    if (points.length > 1) {
        const lngs = points.map((p) => p[0]), lats = points.map((p) => p[1]);
        const pad = 0.01;
        map.fitBounds([[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]], { padding: 40, maxZoom: 14, duration: 0 });
    }

    let incidentMarker = null;
    if (incident?.lng != null) {
        const el = document.createElement('div');
        el.className = 'lab-replay__incident';
        el.innerHTML = `<span class="lab-replay__incident-pin"></span><span class="lab-replay__incident-label">${e(incident.name || 'Reported fire')}</span>`;
        incidentMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([incident.lng, incident.lat]);
    }
    const incidentAt = incident?.started ? Date.parse(incident.started) : null;

    let ready = false;
    let current = t1;

    function detectionData(now) {
        return {
            type: 'FeatureCollection',
            features: dets
                .filter((d) => d.t <= now)
                .map((d) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
                    properties: { age: (now - d.t) / HOUR, frp: d.frp || 1 },
                })),
        };
    }

    function panelHTML(now) {
        const snap = [...snaps].reverse().find((s) => s.t <= now);
        const seen = dets.filter((d) => d.t <= now);
        const sats = new Set(seen.map((d) => d.satellite)).size;
        if (!seen.length) return '<div class="lab-dim">No heat yet</div>';
        const wind = snap?.wind_speed != null
            ? `<div class="lab-replay__wind">
                   <span class="lab-replay__arrow" style="transform:rotate(${(snap.wind_dir + 180) % 360}deg)">↑</span>
                   ${Math.round(snap.wind_speed)} mph from ${COMPASS[Math.round(snap.wind_dir / 45) % 8]}, gusts ${Math.round(snap.wind_gust)}
               </div>
               <div class="lab-dim">Humidity ${Math.round(snap.humidity)}%${snap.red_flag ? ' · Red Flag' : ''}</div>`
            : '';
        return `
            <div><strong>${seen.length}</strong> detection${seen.length === 1 ? '' : 's'} · ${sats} satellite${sats === 1 ? '' : 's'}</div>
            ${snap ? `<div>Signal: <span class="lab-badge lab-badge--${e(snap.level)}">${LEVEL[snap.level] || e(snap.level)}</span> ${snap.score}</div>` : '<div class="lab-dim">Not scored yet</div>'}
            ${wind}`;
    }

    function update(now) {
        current = now;
        slider.value = String(Math.round((1000 * (now - t0)) / (t1 - t0)));
        $('[data-clock]').innerHTML = `${when(now)} <span>${offsetLabel(now - firstHeat)} from first heat</span>`;
        $('[data-panel]').innerHTML = panelHTML(now);
        const last = [...marks].reverse().find((m) => m.t <= now);
        $('[data-caption]').innerHTML = last
            ? `<span class="lab-replay__dot lab-replay__dot--${e(last.kind)}"></span>${e(last.title)}${last.detail ? ` <span class="lab-dim">· ${e(last.detail)}</span>` : ''}`
            : '<span class="lab-dim">Before the first satellite pass</span>';
        if (incidentMarker) {
            if (incidentAt != null && now >= incidentAt) incidentMarker.addTo(map);
            else incidentMarker.remove();
        }
        if (ready) map.getSource('detections').setData(detectionData(now));
    }

    map.on('load', () => {
        map.addSource('detections', { type: 'geojson', data: detectionData(current) });
        map.addLayer({
            id: 'detections-glow',
            type: 'circle',
            source: 'detections',
            filter: ['<', ['get', 'age'], 0.75],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 34],
                'circle-color': '#ffd166',
                'circle-opacity': 0.35,
                'circle-blur': 0.8,
            },
        });
        map.addLayer({
            id: 'detections',
            type: 'circle',
            source: 'detections',
            paint: {
                // VIIRS pixels are ~375 m across; the radius roughly tracks that at local zooms.
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 12, 7, 14, 18],
                'circle-color': ['interpolate', ['linear'], ['get', 'age'], 0, '#fff3b0', 1, '#ff9f1c', 6, '#ff3b1f', 24, '#7a1f12'],
                'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.95, 48, 0.45],
                'circle-stroke-color': 'rgba(0,0,0,0.6)',
                'circle-stroke-width': 1,
            },
        });
        ready = true;
        update(current);
    });

    let raf = 0;
    const playBtn = $('[data-play]');
    function stop() {
        cancelAnimationFrame(raf);
        raf = 0;
        playBtn.textContent = '▶';
        playBtn.setAttribute('aria-label', 'Play');
    }
    function play() {
        let from = current >= t1 ? t0 : current;
        let last = performance.now();
        playBtn.textContent = '❚❚';
        playBtn.setAttribute('aria-label', 'Pause');
        const step = (now) => {
            from += ((now - last) / PLAY_MS) * (t1 - t0);
            last = now;
            if (from >= t1) {
                update(t1);
                stop();
                return;
            }
            update(from);
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }
    playBtn.addEventListener('click', () => (raf ? stop() : play()));
    slider.addEventListener('input', () => {
        stop();
        update(t0 + (Number(slider.value) / 1000) * (t1 - t0));
    });

    update(current);
    return () => {
        stop();
        map.remove();
    };
}
