import * as maplibregl from 'maplibre-gl';
import { LABEL_FONT } from '../config.js';
import { EMPTY_FC, escapeHTML as e, featureCollection } from '../util.js';
import { fetchTrafficIncidents, trafficGeoJSON } from '../sources/traffic.js';
import { formatHour } from '../wind/ocForecast.js';
import { lineLengthKm, miToKm, projector } from './geometry.js';
import { buildHazards, hazardDisplay, HYPOTHETICAL_RADIUS_MI } from './hazards.js';
import { fetchCandidateRoutes, placeName, searchPlaces } from './router.js';
import { rankRoutes } from './score.js';

const STATUS = {
    good: { label: 'Fewest known hazards', color: '#3ddc84' },
    caution: { label: 'Use caution', color: '#ffc93c' },
    avoid: { label: 'Passes near fire', color: '#ff2d78' },
};

const $ = (id) => document.getElementById(id);

function pinElement(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
}

// Points at the given fractions of the route's length.
function pointsAlong(coords, fractions) {
    const xy = coords.map(projector(coords[0]));
    const total = lineLengthKm(xy);
    const out = [];
    let walked = 0;
    let f = 0;
    for (let i = 1; i < coords.length && f < fractions.length; i++) {
        walked += lineLengthKm([xy[i - 1], xy[i]]);
        while (f < fractions.length && walked >= fractions[f] * total) {
            out.push(coords[i]);
            f++;
        }
    }
    return out;
}

// Start, end and three points along the way pin Google to the same path (more waypoints
// get dropped by the mobile apps). Google then adds its live traffic and closures.
function googleMapsLink(route) {
    const ll = ([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const params = new URLSearchParams({
        api: '1',
        origin: ll(route.coords[0]),
        destination: ll(route.end),
        waypoints: pointsAlong(route.coords, [0.25, 0.5, 0.75]).map(ll).join('|'),
        travelmode: 'driving',
    });
    return `https://www.google.com/maps/dir/?${params}`;
}

function routeTitle(r) {
    return `Head ${r.heading}${r.placeName ? ` toward ${e(r.placeName)}` : ''}`;
}

// getContext() → { perimeters, incidents, hotspots, forecast, hour }
export function createPlanner(map, getContext, { onOpen = () => {} } = {}) {
    const state = {
        open: false,
        mode: null, // 'start' | 'fire' | null
        start: null,
        fire: null,
        rangeMi: 20,
        candidates: null,
        candidatesKey: null,
        ranked: [],
        selected: 0,
        busy: false,
        traffic: null, // CHP incidents; null if the feed is unavailable
        avoided: [],
    };
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'evac-popup' });
    const startMarker = new maplibregl.Marker({ element: pinElement('evac-pin evac-pin--start', 'You'), anchor: 'bottom' });
    const fireMarker = new maplibregl.Marker({ element: pinElement('evac-pin evac-pin--fire', '🔥'), anchor: 'center' });

    map.addSource('evac-cones', { type: 'geojson', data: EMPTY_FC });
    map.addSource('evac-zones', { type: 'geojson', data: EMPTY_FC });
    map.addSource('evac-routes', { type: 'geojson', data: EMPTY_FC });
    map.addSource('evac-ends', { type: 'geojson', data: EMPTY_FC });
    map.addSource('evac-traffic', { type: 'geojson', data: EMPTY_FC });
    map.addLayer({ id: 'evac-cones', type: 'fill', source: 'evac-cones', paint: { 'fill-color': '#ff7a1a', 'fill-opacity': 0.13 } }, 'perimeters-fill');
    map.addLayer({ id: 'evac-cones-line', type: 'line', source: 'evac-cones', paint: { 'line-color': '#ff9a3c', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } }, 'perimeters-fill');
    map.addLayer({ id: 'evac-zones', type: 'fill', source: 'evac-zones', paint: { 'fill-color': '#ff3b1f', 'fill-opacity': 0.3 } });
    map.addLayer({ id: 'evac-zones-line', type: 'line', source: 'evac-zones', paint: { 'line-color': '#ff6a3d', 'line-width': 2 } });
    map.addLayer({
        id: 'evac-routes-casing',
        type: 'line',
        source: 'evac-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0d0f12', 'line-width': ['case', ['get', 'selected'], 10, 6], 'line-opacity': 0.85 },
    });
    map.addLayer({
        id: 'evac-routes',
        type: 'line',
        source: 'evac-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['case', ['get', 'selected'], 6, 4],
            'line-opacity': ['case', ['get', 'selected'], 1, 0.6],
        },
    });
    map.addLayer({
        id: 'evac-ends',
        type: 'circle',
        source: 'evac-ends',
        paint: {
            'circle-radius': ['case', ['get', 'selected'], 11, 9],
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#0d0f12',
            'circle-stroke-width': 2,
        },
    });
    map.addLayer({
        id: 'evac-ends-label',
        type: 'symbol',
        source: 'evac-ends',
        layout: { 'text-field': ['get', 'rank'], 'text-font': LABEL_FONT, 'text-size': 12, 'text-allow-overlap': true },
        paint: { 'text-color': '#0d0f12' },
    });
    map.addLayer({
        id: 'evac-traffic',
        type: 'circle',
        source: 'evac-traffic',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 9],
            'circle-color': ['match', ['get', 'severity'], 'blocking', '#ff2d78', '#ffc93c'],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
        },
    });
    map.addLayer({
        id: 'evac-traffic-label',
        type: 'symbol',
        source: 'evac-traffic',
        minzoom: 9,
        layout: { 'text-field': '!', 'text-font': LABEL_FONT, 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': '#0d0f12' },
    });
    const LAYERS = ['evac-cones', 'evac-cones-line', 'evac-zones', 'evac-zones-line', 'evac-routes-casing', 'evac-routes', 'evac-ends', 'evac-ends-label', 'evac-traffic', 'evac-traffic-label'];
    for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', 'none');
    for (const id of ['evac-routes', 'evac-ends', 'evac-traffic']) {
        map.on('mouseenter', id, () => { if (!state.mode) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { if (!state.mode) map.getCanvas().style.cursor = ''; });
    }

    function setStatus(html) {
        $('planner-status').innerHTML = html;
    }

    function setMode(mode) {
        state.mode = mode;
        map.getCanvas().style.cursor = mode ? 'crosshair' : '';
        $('planner-pick-start').classList.toggle('is-active', mode === 'start');
        $('planner-pick-fire').classList.toggle('is-active', mode === 'fire');
        if (mode === 'start') setStatus('Click the map where you’re starting from.');
        if (mode === 'fire') setStatus('Click the map to place a hypothetical fire.');
    }

    function renderRoutesOnMap() {
        map.getSource('evac-routes').setData(featureCollection(
            state.ranked
                .map((r, i) => ({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: r.coords },
                    properties: { index: i, color: STATUS[r.status].color, selected: i === state.selected },
                }))
                // Selected route drawn last (on top).
                .sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected)),
        ));
        map.getSource('evac-ends').setData(featureCollection(
            state.ranked.map((r, i) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: r.end },
                properties: { index: i, color: STATUS[r.status].color, selected: i === state.selected, rank: String(i + 1) },
            })),
        ));
    }

    function renderResults() {
        const list = $('planner-results');
        if (!state.ranked.length) {
            list.innerHTML = '';
            return;
        }
        list.innerHTML = state.ranked
            .map((r, i) => `
                <li>
                    <button class="route route--${r.status}${i === state.selected ? ' is-selected' : ''}" data-route="${i}">
                        <div class="route__top">
                            <span class="route__rank" style="background:${STATUS[r.status].color}">${i + 1}</span>
                            <span class="route__title">${routeTitle(r)}</span>
                            <span class="route__time">${Math.round(r.minutes)} min · ${Math.round(r.miles)} mi</span>
                        </div>
                        <div class="route__status" style="color:${STATUS[r.status].color}">${STATUS[r.status].label}</div>
                        <ul class="route__why">${r.reasons.map((x) => `<li class="why--${x.tone}">${e(x.text)}</li>`).join('')}</ul>
                    </button>
                    <a class="route__link" href="${googleMapsLink(r)}" target="_blank" rel="noopener">Open this route in Google Maps →</a>
                </li>`)
            .join('') + '<li class="route__caveat">Based on current data only. Conditions change fast — if officials direct you elsewhere, go their way.</li>';
        list.querySelectorAll('[data-route]').forEach((btn) => btn.addEventListener('click', () => selectRoute(Number(btn.dataset.route), { fit: true })));
    }

    function routePopupHTML(r, i) {
        return `
            <div class="popup">
                <div class="popup__eyebrow">Route ${i + 1} · <span style="color:${STATUS[r.status].color}">${STATUS[r.status].label}</span></div>
                <h3 class="popup__title">${routeTitle(r)}</h3>
                <p class="popup__summary">${Math.round(r.minutes)} min · ${Math.round(r.miles)} mi</p>
                <a class="popup__cta" href="${googleMapsLink(r)}" target="_blank" rel="noopener">Open in Google Maps →</a>
            </div>`;
    }

    function selectRoute(i, { fit = false, popupAt = null } = {}) {
        state.selected = i;
        renderRoutesOnMap();
        renderResults();
        const r = state.ranked[i];
        if (fit) {
            const bounds = new maplibregl.LngLatBounds(r.coords[0], r.coords[0]);
            r.coords.forEach((c) => bounds.extend(c));
            map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13, duration: 800 });
        }
        popup.setLngLat(popupAt || r.end).setHTML(routePopupHTML(r, i)).addTo(map);
    }

    function trafficPopupHTML(p) {
        const when = p.time ? ` · ${new Date(p.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
        return `
            <div class="popup">
                <div class="popup__eyebrow">CHP incident${when}</div>
                <h3 class="popup__title">${e(p.label)}</h3>
                <p class="popup__summary">${e(p.location)}${p.area ? ` · ${e(p.area)}` : ''}</p>
                <p class="popup__summary">${p.severity === 'blocking' ? 'Evacuation routes are steered around this.' : 'Routes passing this are flagged.'}</p>
            </div>`;
    }

    async function loadTraffic() {
        try {
            state.traffic = await fetchTrafficIncidents();
        } catch {
            state.traffic = null;
        }
        map.getSource('evac-traffic').setData(trafficGeoJSON(state.traffic || []));
    }

    // Road-blocking incidents near the start, nearest first (Valhalla accepts up to 50).
    function blockingNearStart() {
        if (!state.traffic) return [];
        const project = projector(state.start);
        const reachKm = miToKm(state.rangeMi) * 2;
        return state.traffic
            .filter((t) => t.severity === 'blocking')
            .map((t) => ({ t, km: Math.hypot(...project(t.coords)) }))
            .filter((x) => x.km < reachKm)
            .sort((a, b) => a.km - b.km)
            .slice(0, 50)
            .map((x) => x.t);
    }

    // Hazards depend on the fire data, hypothetical fire, and timeline hour; re-scoring is cheap,
    // so it reruns whenever those change. Routes are only refetched when start or range change.
    function rescore() {
        if (!state.start || !state.candidates) return;
        const context = getContext();
        const hazards = buildHazards({ start: state.start, rangeMi: state.rangeMi, hypothetical: state.fire, ...context });
        const display = hazardDisplay(hazards);
        map.getSource('evac-cones').setData(display.cones);
        map.getSource('evac-zones').setData(display.zones);

        const { routes, startHazard } = rankRoutes(state.candidates, state.start, hazards, state.rangeMi, state.traffic);
        const previousNames = new Map(state.ranked.map((r) => [r.end.join(), r.placeName]));
        const selectedEnd = state.ranked[state.selected]?.end.join();
        state.ranked = routes.map((r) => ({ ...r, placeName: previousNames.get(r.end.join()) }));
        state.selected = Math.max(0, state.ranked.findIndex((r) => r.end.join() === selectedEnd));
        renderRoutesOnMap();
        renderResults();

        const windNote = context.forecast ? `Spread zones use forecast wind for <strong>${formatHour(context.forecast.times[context.hour])}</strong> (move the timeline to change).` : '';
        const threat = Number.isFinite(startHazard.mi)
            ? `Nearest fire threat: <strong>${e(startHazard.zone.name)}</strong>, ${startHazard.mi < 1 ? startHazard.mi.toFixed(1) : Math.round(startHazard.mi)} mi away.`
            : `No active fire within ${state.rangeMi + 40} mi. Place a hypothetical fire to plan ahead.`;
        const trafficNote = !state.traffic
            ? ' Live CHP traffic incidents are unavailable right now.'
            : state.avoided.length
                ? ` Steering around ${state.avoided.length} CHP-reported closure${state.avoided.length === 1 ? '' : 's'} / SigAlert${state.avoided.length === 1 ? '' : 's'} nearby.`
                : ' No CHP-reported road closures nearby.';
        setStatus(`${threat} ${windNote}${hazards.cones.length ? ' <span class="planner__cone-key">Orange wedges = likely spread direction.</span>' : ''}${trafficNote}`);

        // Name destinations lazily (reverse geocode), then re-render.
        state.ranked.forEach((r) => {
            if (r.placeName !== undefined) return;
            r.placeName = null;
            placeName(r.end).then((name) => {
                r.placeName = name;
                renderResults();
            });
        });
    }

    // Refetches routes when the start, range, or set of nearby road closures changes; otherwise
    // just re-scores. The map only re-frames when the start or range changed.
    async function compute() {
        if (!state.start) return;
        await loadTraffic();
        const origin = `${state.start.join(',')}|${state.rangeMi}`;
        const avoid = blockingNearStart();
        const key = `${origin}|${avoid.map((t) => t.id).sort().join(',')}`;
        const reframe = !state.candidatesKey?.startsWith(`${origin}|`);
        if (state.candidatesKey !== key) {
            state.busy = true;
            state.ranked = [];
            renderRoutesOnMap();
            renderResults();
            setStatus('Finding routes out… <span class="planner__progress"><i style="width:0%"></i></span>');
            try {
                const candidates = await fetchCandidateRoutes(state.start, state.rangeMi, {
                    avoid: avoid.map((t) => t.coords),
                    onProgress: (p) => {
                        const bar = document.querySelector('.planner__progress i');
                        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
                    },
                });
                if (`${state.start.join(',')}|${state.rangeMi}` !== origin) return;
                state.candidates = candidates;
                state.candidatesKey = key;
                state.avoided = avoid;
            } catch (err) {
                setStatus(`Routing failed: ${e(err.message)}`);
                return;
            } finally {
                state.busy = false;
            }
            if (!state.candidates.length) {
                setStatus('No drivable routes found from here. Try a point on or near a road.');
                return;
            }
        }
        rescore();
        if (!reframe) return;
        popup.remove();
        const bounds = new maplibregl.LngLatBounds(state.start, state.start);
        state.ranked.forEach((r) => r.coords.forEach((c) => bounds.extend(c)));
        if (state.fire) bounds.extend(state.fire);
        map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13, duration: 1000 });
    }

    function setStart(coords, label) {
        state.start = coords;
        startMarker.setLngLat(coords).addTo(map);
        if (label) $('planner-q').value = label;
        setMode(null);
        compute();
    }

    function setFire(coords) {
        state.fire = coords;
        fireMarker.setLngLat(coords).addTo(map);
        $('planner-clear-fire').hidden = false;
        setMode(null);
        if (state.start) rescore();
        else setStatus(`Hypothetical ${HYPOTHETICAL_RADIUS_MI}-mile fire placed. Now set your starting point.`);
    }

    // --- controls ---
    let searchTimer = null;
    $('planner-q').addEventListener('input', (ev) => {
        clearTimeout(searchTimer);
        const q = ev.target.value.trim();
        const list = $('planner-suggest');
        if (q.length < 3) {
            list.hidden = true;
            return;
        }
        searchTimer = setTimeout(async () => {
            const results = await searchPlaces(q, map.getCenter().toArray());
            list.innerHTML = results.map((r, i) => `<li><button data-i="${i}">${e(r.label)}</button></li>`).join('');
            list.hidden = !results.length;
            list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
                const r = results[Number(b.dataset.i)];
                list.hidden = true;
                setStart(r.coords, r.label);
            }));
        }, 300);
    });
    $('planner-locate').addEventListener('click', () => {
        if (!navigator.geolocation) return setStatus('Location isn’t available in this browser.');
        setStatus('Finding your location…');
        navigator.geolocation.getCurrentPosition(
            (pos) => setStart([pos.coords.longitude, pos.coords.latitude], 'My location'),
            (err) => setStatus(`Couldn’t get your location: ${e(err.message)}`),
            { enableHighAccuracy: true, timeout: 10000 },
        );
    });
    $('planner-pick-start').addEventListener('click', () => setMode(state.mode === 'start' ? null : 'start'));
    $('planner-pick-fire').addEventListener('click', () => setMode(state.mode === 'fire' ? null : 'fire'));
    $('planner-clear-fire').addEventListener('click', () => {
        state.fire = null;
        fireMarker.remove();
        $('planner-clear-fire').hidden = true;
        rescore();
        if (!state.start) setStatus('');
    });
    document.querySelectorAll('#planner-range button').forEach((btn) => btn.addEventListener('click', () => {
        state.rangeMi = Number(btn.dataset.range);
        document.querySelectorAll('#planner-range button').forEach((b) => b.classList.toggle('is-active', b === btn));
        compute();
    }));

    // Frame routes in the part of the map the drawer doesn't cover (side panel on desktop, bottom sheet on phones).
    function fitPadding() {
        const sheet = $('planner').getBoundingClientRect();
        const view = map.getContainer().getBoundingClientRect();
        if (sheet.width >= view.width - 40) return { top: 60, left: 40, right: 40, bottom: Math.max(40, view.bottom - sheet.top + 24) };
        return { top: 60, bottom: 160, left: sheet.right - view.left + 40, right: 60 };
    }

    function setOpen(open) {
        if (open) onOpen();
        state.open = open;
        $('planner').hidden = !open;
        map.getContainer().parentElement.classList.toggle('is-planning', open);
        $('planner-open').hidden = open;
        for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', open ? 'visible' : 'none');
        if (open) {
            loadTraffic();
            if (state.start) startMarker.addTo(map);
            if (state.fire) fireMarker.addTo(map);
        } else {
            startMarker.remove();
            fireMarker.remove();
            popup.remove();
            setMode(null);
        }
    }
    $('planner-open').addEventListener('click', () => setOpen(true));
    $('planner-close').addEventListener('click', () => setOpen(false));

    return {
        // Returns true when the click was used by the planner (so normal popups are skipped).
        handleMapClick(lngLat) {
            if (!state.open) return false;
            if (!state.mode) {
                const p = map.project(lngLat);
                const hits = map.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ['evac-traffic', 'evac-ends', 'evac-routes'] });
                if (!hits.length) return false;
                const hit = hits[0];
                if (hit.layer.id === 'evac-traffic') popup.setLngLat(hit.geometry.coordinates).setHTML(trafficPopupHTML(hit.properties)).addTo(map);
                else selectRoute(hit.properties.index, { popupAt: lngLat });
                return true;
            }
            const coords = [lngLat.lng, lngLat.lat];
            if (state.mode === 'start') setStart(coords, `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`);
            else setFire(coords);
            return true;
        },
        openAt(coords, label) {
            setOpen(true);
            setStart(coords, label);
        },
        close() {
            if (state.open) setOpen(false);
        },
        // Fire data or timeline hour changed.
        refresh() {
            if (state.open && !state.busy) compute();
        },
    };
}
