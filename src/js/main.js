import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../sass/ocfire.scss';

import { BASEMAPS, FORECAST_POINTS, INITIAL_ZOOM, OC_CENTER, REFRESH_MS, WIND_REFRESH_MS } from './config.js';
import { addBasemapLayers, addFireLayers, addHazardLayers, animateActiveEdge, animateHeatPulse, setGroupVisibility, setSatellite, setSelectedIncident } from './layers.js';
import { fetchPerimeters, linkPerimeters } from './sources/perimeters.js';
import { fetchIncidents } from './sources/incidents.js';
import { fetchHotspotHistory, fetchHotspots, hotspotsEnabled } from './sources/hotspots.js';
import { fetchBaseline } from './sources/baseline.js';
import { fetchFireWeather } from './sources/fireWeather.js';
import { fetchSmoke } from './sources/smoke.js';
import { FHSZ_MIN_ZOOM, fetchZonesInView } from './sources/fhsz.js';
import { fetchPower } from './sources/power.js';
import { camerasNear, loadCameras } from './sources/cameras.js';
import { findUnmatchedHeat } from './earlyDetection.js';
import { createIncidentMarkers } from './incidentMarkers.js';
import { closeSheet, createMapCard, sheetOverlap } from './mapCard.js';
import { showDisclaimerIfNeeded } from './about.js';
import { fetchWindForecast } from './sources/weather.js';
import { fetchPointAirQuality } from './sources/airQuality.js';
import { WindParticles } from './wind/particles.js';
import { addWindArrowLayer, windArrowData } from './wind/arrows.js';
import { conditionsAt, fireWindOutlook, pointSeries } from './wind/fireWeather.js';
import { createHdwLayer } from './wind/hdwLayer.js';
import { createPlanner } from './evac/planner.js';
import { createReadiness } from './ready/ready.js';
import { renderOCForecast, chartHourFromEvent } from './wind/ocForecast.js';
import { createTimeline } from './wind/timeline.js';
import { incidentPopup, perimeterPopup, hotspotPopup, fireWeatherPopup, heatPopup, smokePopup, fhszPopup, powerPopup } from './popups.js';
import { renderStats, renderIncidentList, renderFireWeatherBanner, setStatus, markSourceStatus } from './sidebar.js';
import { pointInGeometry } from './geo.js';
import { EMPTY_FC, bboxOf, normalizeName, formatClock, featureCollection } from './util.js';

const state = {
    incidents: EMPTY_FC,
    perimeters: EMPTY_FC,
    hotspots: EMPTY_FC,
    unmatchedHeat: EMPTY_FC,
    heatContext: { history: [], baseline: null },
    hotspotCount: null,
    fireWeather: EMPTY_FC,
    overlays: { smoke: false, fhsz: false, power: false },
    selectedId: null,
    wind: { forecast: null, series: {}, air: {}, ocPoint: 'central', hour: 0, flow: true, arrows: false, hdw: false },
};

// MapLibre locates its worker relative to its own module URL, which breaks once Vite bundles it.
showDisclaimerIfNeeded();
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS.dark,
    center: OC_CENTER,
    zoom: INITIAL_ZOOM,
    attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

const popup = createMapCard(map, { maxWidth: '320px', closeButton: true, offset: 12 });
// Opens below the pin so it doesn't cover the marker card above it.
const incidentCard = createMapCard(map, { maxWidth: '340px', closeButton: true, anchor: 'top', offset: 10, className: 'incident-popup' });
let incidentMarkers = null;
let windParticles = null;
let timeline = null;
let hdwLayer = null;
let planner = null;
let readiness = null;

// One label per fire; labelling the polygon source directly repeats it on every MultiPolygon part.
function perimeterLabelPoints(perimeters) {
    return featureCollection(
        perimeters.features
            .filter((f) => !f.properties.incidentId)
            .map((f) => {
                const [[w, s], [e, n]] = bboxOf(f.geometry);
                return { type: 'Feature', geometry: { type: 'Point', coordinates: [(w + e) / 2, (s + n) / 2] }, properties: { name: f.properties.name } };
            }),
    );
}

function selectIncident(id, { fly = true } = {}) {
    const feature = state.incidents.features.find((f) => f.properties.id === id);
    if (!feature) return;
    setSelection(id);
    popup.remove();
    incidentCard.setLngLat(feature.geometry.coordinates).setHTML(incidentCardHTML(feature)).addTo(map, { pan: !fly });

    if (fly) {
        // Leave room for the marker card above the pin, and below it for the summary popup (desktop) or the sheet covering the map (phones).
        const height = map.getContainer().clientHeight;
        const overlap = sheetOverlap(map);
        const padding = { top: 90, bottom: overlap ? overlap + 24 : Math.min(320, height * 0.45), left: 60, right: 60 };
        const perimeter = state.perimeters.features.find((f) => normalizeName(f.properties.name) === normalizeName(feature.properties.name));
        const bounds = perimeter ? bboxOf(perimeter.geometry) : null;
        if (bounds) {
            const coords = feature.geometry.coordinates;
            bounds[0] = [Math.min(bounds[0][0], coords[0]), Math.min(bounds[0][1], coords[1])];
            bounds[1] = [Math.max(bounds[1][0], coords[0]), Math.max(bounds[1][1], coords[1])];
            map.fitBounds(bounds, { padding, maxZoom: 13, duration: 1400, essential: true });
        } else {
            map.flyTo({ center: feature.geometry.coordinates, zoom: 12, padding, duration: 1400, essential: true });
        }
    }
}

function incidentCardHTML(feature) {
    const { forecast, hour } = state.wind;
    const outlook = forecast ? fireWindOutlook(forecast, hour, feature.geometry.coordinates) : null;
    return incidentPopup(feature.properties, outlook, camerasNear(feature.geometry.coordinates));
}

function selectHeat(id) {
    const feature = state.unmatchedHeat.features.find((f) => f.properties.id === id);
    if (!feature) return;
    const coords = feature.geometry.coordinates;
    incidentCard.remove();
    popup.setLngLat(coords).setHTML(heatPopup(feature.properties, camerasNear(coords), coords)).addTo(map, { pan: false });
    // On desktop, sit the spot low enough that the card above it has room.
    const overlap = sheetOverlap(map);
    const top = overlap ? 0 : Math.min(360, map.getContainer().clientHeight * 0.4);
    map.flyTo({ center: coords, zoom: 11, padding: { top, bottom: overlap, left: 0, right: 0 }, duration: 1200, essential: true });
}

function windAtFire(coords) {
    return state.wind.forecast ? conditionsAt(state.wind.forecast, state.wind.hour, coords) : null;
}

function updateUnmatchedHeat() {
    state.unmatchedHeat = findUnmatchedHeat(state.hotspots, state.incidents, state.perimeters, {
        ...state.heatContext,
        fireWeather: state.fireWeather,
        // Scored on current conditions, not the timeline hour.
        windAt: (coords) => (state.wind.forecast ? conditionsAt(state.wind.forecast, 0, coords) : null),
    });
    map.getSource('unmatched-heat').setData(state.unmatchedHeat);
}

function setSelection(id) {
    state.selectedId = id;
    setSelectedIncident(map, id);
    incidentMarkers.setSelected(id);
    renderList();
}

function renderList() {
    renderIncidentList(state.incidents, state.selectedId, (id) => selectIncident(id), state.unmatchedHeat, selectHeat);
}

function renderAll() {
    renderStats(state.incidents, state.hotspotCount);
    renderList();
}

// Runs fn now and every `ms`, but not while the tab is hidden; catches up on return if it's due.
function whileVisible(fn, ms) {
    let last = Date.now();
    fn();
    const run = () => {
        if (document.hidden || Date.now() - last < ms - 1000) return;
        last = Date.now();
        fn();
    };
    setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
}

// Overlapping calls (button mashing, auto-refresh firing mid-click) share the run in progress.
// Each source also caches for 1–10 min (see sources/*), so a manual refresh only refetches what's stale.
let refreshing = null;
function refresh() {
    refreshing ??= runRefresh().finally(() => {
        refreshing = null;
    });
    return refreshing;
}

async function runRefresh() {
    setStatus('Refreshing…', 'busy');
    document.getElementById('refresh').classList.add('is-spinning');

    const loaders = {
        incidents: fetchIncidents(),
        perimeters: fetchPerimeters(),
        hotspots: hotspotsEnabled ? fetchHotspots() : Promise.resolve(null),
        fireWeather: fetchFireWeather(),
        hotspotHistory: hotspotsEnabled ? fetchHotspotHistory() : Promise.resolve([]),
        baseline: hotspotsEnabled ? fetchBaseline() : Promise.resolve(null),
    };
    const names = Object.keys(loaders);
    const settled = await Promise.allSettled(Object.values(loaders));
    const results = Object.fromEntries(names.map((n, i) => [n, settled[i]]));

    const { incidents, perimeters, hotspots, fireWeather, hotspotHistory, baseline } = results;
    state.heatContext.history = hotspotHistory.value || [];
    state.heatContext.baseline = baseline.value || null;
    if (fireWeather.status === 'fulfilled') state.fireWeather = fireWeather.value;
    if (incidents.status === 'fulfilled') state.incidents = incidents.value;
    if (perimeters.status === 'fulfilled') {
        state.perimeters = linkPerimeters(perimeters.value.current, state.incidents);
        map.getSource('perimeters').setData(state.perimeters);
        map.getSource('perimeter-history').setData(perimeters.value.history);
        map.getSource('perimeter-labels').setData(perimeterLabelPoints(state.perimeters));
    }
    incidentMarkers.update(state.incidents, windAtFire);
    if (hotspots.status === 'fulfilled' && hotspots.value) {
        state.hotspots = hotspots.value;
        state.hotspotCount = hotspots.value.features.length;
        map.getSource('hotspots').setData(hotspots.value);
    }
    updateUnmatchedHeat();
    if (state.overlays.smoke) loadOverlay('smoke');
    if (state.overlays.power) loadOverlay('power');
    if (fireWeather.status === 'fulfilled') {
        map.getSource('fireweather').setData(fireWeather.value);
        const overOC = fireWeather.value.features.filter((f) => pointInGeometry(OC_CENTER, f.geometry));
        const worst = overOC.find((f) => f.properties.event === 'Red Flag Warning') || overOC[0];
        renderFireWeatherBanner(worst?.properties);
    }

    if (!hotspotsEnabled) results.hotspots = { status: 'disabled' };
    markSourceStatus(results);
    renderAll();
    planner.refresh();
    readiness.refresh();

    const failed = settled.filter((r) => r.status === 'rejected');
    failed.forEach((r) => console.warn('[ocfire] source failed:', r.reason));
    setStatus(
        failed.length ? `Updated ${formatClock(new Date())} · ${failed.length} source(s) failed` : `Updated ${formatClock(new Date())} · auto-refresh 5 min`,
        failed.length ? 'warn' : 'ok',
    );
    document.getElementById('refresh').classList.remove('is-spinning');
}

function renderOCPanel() {
    const { series, air, ocPoint, hour } = state.wind;
    renderOCForecast(document.getElementById('oc-forecast'), FORECAST_POINTS, series, ocPoint, hour, air);
}

function setWindHour(hour) {
    const { forecast } = state.wind;
    if (!forecast) return;
    state.wind.hour = hour;
    windParticles.setHour(hour);
    if (state.wind.arrows) map.getSource('wind-arrows').setData(windArrowData(forecast, hour));
    if (state.wind.hdw) hdwLayer.setHour(hour);
    renderOCPanel();
    incidentMarkers.update(state.incidents, windAtFire);
    // Keep an open fire card in sync with the timeline.
    planner.refresh();
    const open = state.selectedId && incidentCard.isOpen() && state.incidents.features.find((f) => f.properties.id === state.selectedId);
    if (open) incidentCard.setHTML(incidentCardHTML(open));
}

function updateWindVisibility() {
    const { flow, arrows, hdw, forecast, hour } = state.wind;
    windParticles.setVisible(flow);
    map.setLayoutProperty('wind-arrows', 'visibility', arrows ? 'visible' : 'none');
    if (arrows && forecast) map.getSource('wind-arrows').setData(windArrowData(forecast, hour));
    if (hdw && forecast) hdwLayer.setHour(hour);
    hdwLayer.setVisible(hdw);
    document.querySelector('.legend__hdw').hidden = !hdw;
    timeline.setVisible(Boolean(forecast) && (flow || arrows || hdw));
}

async function refreshWind() {
    try {
        if (document.hidden && state.wind.forecast) return;
        const forecast = await fetchWindForecast();
        state.wind.forecast = forecast;
        state.wind.series = Object.fromEntries(FORECAST_POINTS.map((p) => [p.id, pointSeries(forecast, p.id)]));
        windParticles.setForecast(forecast);
        hdwLayer.setForecast(forecast, Math.min(state.wind.hour, forecast.times.length - 1));
        timeline.setTimes(forecast.times, state.wind.series[state.wind.ocPoint]);
        setWindHour(Math.min(state.wind.hour, forecast.times.length - 1));
        updateWindVisibility();
        updateUnmatchedHeat();
        renderList();
        markSourceStatus({ wind: { status: 'fulfilled' } });
        refreshAir();
    } catch (err) {
        console.warn('[ocfire] wind forecast failed:', err);
        markSourceStatus({ wind: { status: 'rejected', reason: err } });
        document.getElementById('oc-forecast').innerHTML = '<p class="oc-outlook">Wind forecast unavailable.</p>';
    }
}

async function refreshAir() {
    try {
        state.wind.air = await fetchPointAirQuality();
        if (state.wind.forecast) renderOCPanel();
    } catch (err) {
        console.warn('[ocfire] air quality failed:', err);
    }
}

function setForecastPoint(id) {
    state.wind.ocPoint = id;
    timeline.setTimes(state.wind.forecast.times, state.wind.series[id]);
    renderOCPanel();
}

// Smoke, hazard zones and power are fetched only while their layer is switched on.
async function loadOverlay(name) {
    try {
        if (name === 'smoke') {
            const smoke = await fetchSmoke();
            map.getSource('smoke').setData(smoke);
            document.querySelector('.legend__smoke-none').hidden = smoke.features.length > 0;
        }
        if (name === 'power') {
            const { areas, points } = await fetchPower();
            map.getSource('power-areas').setData(areas);
            map.getSource('power-points').setData(points);
        }
        if (name === 'fhsz') await loadHazardZones();
        markSourceStatus({ [name]: { status: 'fulfilled' } });
    } catch (err) {
        console.warn(`[ocfire] ${name} failed:`, err);
        markSourceStatus({ [name]: { status: 'rejected', reason: err } });
    }
}

let fhszRequest = 0;
async function loadHazardZones() {
    const zoomedIn = map.getZoom() >= FHSZ_MIN_ZOOM;
    document.querySelector('.legend__fhsz-zoom').hidden = zoomedIn;
    if (!zoomedIn) {
        map.getSource('fhsz').setData(EMPTY_FC);
        return;
    }
    const request = ++fhszRequest;
    const b = map.getBounds();
    const zones = await fetchZonesInView([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], Math.round(map.getZoom()));
    if (request === fhszRequest) map.getSource('fhsz').setData(zones);
}

function setOverlay(name, on) {
    state.overlays[name] = on;
    setGroupVisibility(map, name, on);
    const legend = document.querySelector(`.legend__${name}`);
    if (legend) legend.hidden = !on;
    if (on) loadOverlay(name);
}

function wireInteractions() {
    const clickTargets = [
        ['heat-ring', (f) => heatPopup(f.properties, camerasNear(f.geometry.coordinates), f.geometry.coordinates)],
        ['hotspots-core', (f) => hotspotPopup(f.properties)],
        ['power-points', (f) => powerPopup(f.properties)],
        ['perimeters-fill', (f) => {
            if (f.properties.incidentId) setSelection(f.properties.incidentId);
            return perimeterPopup(f.properties);
        }],
        ['power-fill', (f) => powerPopup(f.properties)],
        ['fireweather-fill', (f) => fireWeatherPopup(f.properties)],
        ['smoke-fill', (f) => smokePopup(f.properties)],
        ['fhsz-fill', (f) => fhszPopup(f.properties)],
    ];

    map.on('click', (ev) => {
        if (planner.handleMapClick(ev.lngLat) || readiness.handleMapClick(ev.lngLat)) return;
        // Topmost interactive layer wins.
        for (const [layer, render] of clickTargets) {
            if (!map.getLayer(layer) || map.getLayoutProperty(layer, 'visibility') === 'none') continue;
            const [feature] = map.queryRenderedFeatures(ev.point, { layers: [layer] });
            if (!feature) continue;
            const html = render(feature);
            if (html) {
                incidentCard.remove();
                popup.setLngLat(ev.lngLat).setHTML(html).addTo(map);
            }
            return;
        }
        closeSheet();
    });

    for (const [layer] of clickTargets) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
}

function wireControls() {
    document.getElementById('legend-toggle').addEventListener('click', (ev) => {
        const open = document.getElementById('legend').classList.toggle('is-open');
        ev.currentTarget.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('[data-layer-toggle]').forEach((input) => {
        input.addEventListener('change', () => {
            const group = input.dataset.layerToggle;
            if (group === 'incidents') incidentMarkers.setVisible(input.checked);
            else if (group in state.overlays) setOverlay(group, input.checked);
            else setGroupVisibility(map, group, input.checked);
        });
    });
    document.querySelectorAll('[data-wind-toggle]').forEach((input) => {
        input.addEventListener('change', () => {
            state.wind[input.dataset.windToggle] = input.checked;
            updateWindVisibility();
        });
    });
    const ocPanel = document.getElementById('oc-forecast');
    ocPanel.addEventListener('change', (ev) => {
        if (ev.target.matches('[data-oc-select]')) setForecastPoint(ev.target.value);
    });
    ocPanel.addEventListener('click', (ev) => {
        const tab = ev.target.closest('[data-oc-point]');
        if (tab) {
            setForecastPoint(tab.dataset.ocPoint);
            return;
        }
        if (ev.target.closest('[data-oc-fly]')) {
            const point = FORECAST_POINTS.find((p) => p.id === state.wind.ocPoint);
            map.flyTo({ center: point.coords, zoom: 10, duration: 1200 });
            return;
        }
        const hour = state.wind.forecast && chartHourFromEvent(ev, state.wind.forecast.times.length);
        if (hour != null) timeline.setHour(hour);
    });
    document.getElementById('toggle-satellite').addEventListener('change', (ev) => setSatellite(map, ev.target.checked));

    document.getElementById('refresh').addEventListener('click', refresh);
    document.getElementById('recenter').addEventListener('click', () => map.flyTo({ center: OC_CENTER, zoom: INITIAL_ZOOM, duration: 1000 }));

    if (!hotspotsEnabled) {
        const input = document.querySelector('[data-layer-toggle="hotspots"]');
        input.checked = false;
        input.disabled = true;
        input.closest('label').title = 'Set FIRMS_MAP_KEY in .env.local to enable';
    }
}

map.on('load', () => {
    addBasemapLayers(map);
    addFireLayers(map);
    addHazardLayers(map);
    animateActiveEdge(map);
    animateHeatPulse(map);
    incidentMarkers = createIncidentMarkers(map, (id) => selectIncident(id));
    addWindArrowLayer(map, 'hotspots-glow');
    windParticles = new WindParticles(map);
    hdwLayer = createHdwLayer(map, 'fireweather-fill');
    if (import.meta.env.DEV) window.__ocfire = { map, state };
    planner = createPlanner(map, () => ({
        perimeters: state.perimeters,
        incidents: state.incidents,
        hotspots: state.hotspots,
        forecast: state.wind.forecast,
        hour: state.wind.hour,
    }), { onOpen: () => { readiness.close(); closeSheet(); } });
    readiness = createReadiness(map, () => ({
        incidents: state.incidents,
        perimeters: state.perimeters,
        fireWeather: state.fireWeather,
        forecast: state.wind.forecast,
        hour: state.wind.hour,
    }), {
        onOpen: () => { planner.close(); closeSheet(); },
        onPlanFrom: (coords, label) => planner.openAt(coords, label),
    });
    timeline = createTimeline(setWindHour);
    wireInteractions();
    wireControls();
    if (!hotspotsEnabled) setGroupVisibility(map, 'hotspots', false);
    whileVisible(refresh, REFRESH_MS);
    whileVisible(refreshWind, WIND_REFRESH_MS);
    map.on('moveend', () => {
        if (state.overlays.fhsz) loadOverlay('fhsz');
    });
    loadCameras()
        .then(() => {
            // Re-render anything that was showing "Loading cameras…".
            const open = state.selectedId && incidentCard.isOpen() && state.incidents.features.find((f) => f.properties.id === state.selectedId);
            if (open) incidentCard.setHTML(incidentCardHTML(open));
        })
        .catch((err) => console.warn('[ocfire] cameras failed:', err));
});
