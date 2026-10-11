import * as maplibregl from 'maplibre-gl';
import { pointInGeometry } from '../geo.js';
import { aqiLevel, airOutlook, fetchAirQualityAt } from '../sources/airQuality.js';
import { FHSZ_MEANING, zoneAt } from '../sources/fhsz.js';
import { fetchPower } from '../sources/power.js';
import { escapeHTML as e, distanceMiles, formatMiles } from '../util.js';
import { compass, fireWindOutlook } from '../wind/fireWeather.js';
import { placeName, searchPlaces } from '../evac/router.js';
import { CHECKLISTS } from './checklists.js';

const PLACE_KEY = 'ocfire.place.v1';
const DONE_KEY = 'ocfire.ready.v1';
const $ = (id) => document.getElementById(id);

function load(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage unavailable; the session still works
    }
}

// Distance to the nearest fire: perimeter vertices when mapped, otherwise the incident point.
function nearestFire(coords, incidents, perimeters) {
    let best = null;
    const consider = (name, mi) => {
        if (!best || mi < best.mi) best = { name, mi };
    };
    for (const f of perimeters.features) {
        if (pointInGeometry(coords, f.geometry)) return { name: f.properties.name, mi: 0 };
        const walk = (c) => (typeof c[0] === 'number' ? consider(f.properties.name, distanceMiles(c, coords)) : c.forEach(walk));
        walk(f.geometry.coordinates);
    }
    for (const f of incidents.features) consider(f.properties.name, distanceMiles(f.geometry.coordinates, coords));
    return best;
}

function row(tone, title, body) {
    return `<li class="check check--${tone}"><strong>${title}</strong>${body ? `<p>${body}</p>` : ''}</li>`;
}

// getContext() → { incidents, perimeters, fireWeather, forecast, hour }
// onPlanFrom(coords, label) opens the evacuation planner at this place.
export function createReadiness(map, getContext, { onOpen = () => {}, onPlanFrom = () => {} } = {}) {
    const state = { open: false, tab: 'place', place: load(PLACE_KEY, null), done: new Set(load(DONE_KEY, [])), picking: false };
    const marker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'evac-pin evac-pin--home', textContent: 'My place' }), anchor: 'bottom' });

    function renderTabs() {
        const total = CHECKLISTS.reduce((n, l) => n + l.sections.reduce((m, s) => m + s.items.length, 0), 0);
        const done = CHECKLISTS.reduce((n, l) => n + l.sections.reduce((m, s) => m + s.items.filter(([id]) => state.done.has(id)).length, 0), 0);
        $('ready-tabs').innerHTML = [['place', 'My place'], ...CHECKLISTS.map((l) => [l.id, l.tab])]
            .map(([id, label]) => `<button class="chip${state.tab === id ? ' is-active' : ''}" data-tab="${id}">${e(label)}</button>`)
            .join('');
        $('ready-progress').innerHTML = `<span style="width:${Math.round((done / total) * 100)}%"></span>`;
        $('ready-progress').title = `${done} of ${total} readiness steps done`;
        $('ready-progress-label').textContent = `${done} / ${total} steps done`;
    }

    function renderChecklist(list) {
        return `
            <p class="ready__intro">${e(list.intro)}</p>
            ${list.sections.map((s) => `
                <div class="ready__section">
                    <div class="planner__label">${e(s.title)}</div>
                    <ul class="ready__list">
                        ${s.items.map(([id, text, link]) => `
                            <li><label class="ready__item">
                                <input type="checkbox" data-item="${id}"${state.done.has(id) ? ' checked' : ''}>
                                <span>${e(text)}${link ? ` <a href="${e(link)}" target="_blank" rel="noopener">→</a>` : ''}</span>
                            </label></li>`).join('')}
                    </ul>
                </div>`).join('')}`;
    }

    function renderPlaceShell() {
        return `
            <p class="ready__intro">Check any address: its official fire hazard zone, the nearest active fire, current warnings, wind, air quality and power.</p>
            <div class="planner__search">
                <input id="ready-q" type="search" placeholder="Search an address…" autocomplete="off" value="${e(state.place?.label || '')}">
                <ul id="ready-suggest" class="planner__suggest" hidden></ul>
            </div>
            <div class="planner__row">
                <button id="ready-locate" class="chip">◎ Use my location</button>
                <button id="ready-pick" class="chip${state.picking ? ' is-active' : ''}">Pick on map</button>
            </div>
            <ul id="ready-report" class="ready__report">${state.place ? '<li class="check">Checking…</li>' : ''}</ul>
            <div id="ready-actions" class="planner__row" ${state.place ? '' : 'hidden'}>
                <button id="ready-plan" class="chip">Plan evacuation routes from here</button>
            </div>`;
    }

    function render() {
        renderTabs();
        const list = CHECKLISTS.find((l) => l.id === state.tab);
        $('ready-body').innerHTML = list ? renderChecklist(list) : renderPlaceShell();
        if (!list && state.place) checkPlace();
    }

    async function checkPlace() {
        const { coords } = state.place;
        const ctx = getContext();
        const report = $('ready-report');
        if (!report) return;
        const rows = [];

        const fire = nearestFire(coords, ctx.incidents, ctx.perimeters);
        if (!fire) rows.push(row('good', 'No active fires reported in California'));
        else if (fire.mi === 0) rows.push(row('bad', `Inside the ${e(fire.name)} perimeter`, 'Follow official evacuation orders now.'));
        else rows.push(row(fire.mi < 5 ? 'bad' : fire.mi < 15 ? 'warn' : 'good', `Nearest active fire: ${e(fire.name)}, ${formatMiles(fire.mi)} away`));

        const alerts = (ctx.fireWeather?.features || []).filter((f) => pointInGeometry(coords, f.geometry));
        const redFlag = alerts.find((f) => f.properties.event === 'Red Flag Warning');
        if (redFlag) rows.push(row('bad', 'Red Flag Warning in effect here', 'Critical fire weather. See the Red Flag days list.'));
        else if (alerts.length) rows.push(row('warn', `${e(alerts[0].properties.event)} in effect here`));
        else rows.push(row('good', 'No Red Flag Warning or Fire Weather Watch here'));

        if (ctx.forecast) {
            const outlook = fireWindOutlook(ctx.forecast, ctx.hour, coords);
            if (outlook) {
                const { now, peak } = outlook;
                const level = [now.level, peak.level].includes('critical') ? 'bad' : [now.level, peak.level].includes('elevated') ? 'warn' : 'good';
                rows.push(row(level, `Wind ${compass(now.dir)} ${Math.round(now.speed)} mph, humidity ${Math.round(now.rh)}%`,
                    peak.gust > now.gust + 3 ? `Gusts to ${Math.round(peak.gust)} mph in the next 24h.` : ''));
            }
        }
        report.innerHTML = rows.join('') + '<li class="check">Checking hazard zone, air and power…</li>';

        const [zone, air, power] = await Promise.allSettled([zoneAt(coords), fetchAirQualityAt(coords), fetchPower()]);
        if (state.place?.coords !== coords || !$('ready-report')) return;

        let nextStep = '';
        if (zone.status === 'fulfilled') {
            const z = zone.value;
            if (z?.level >= 2) nextStep = '<li><button class="chip" data-tab="space">Start the defensible-space checklist →</button></li>';
            rows.unshift(z
                ? row(z.level === 3 ? 'bad' : z.level === 2 ? 'warn' : 'good', `${e(z.label)} Fire Hazard Severity Zone`, `${e(z.area)}. ${e(FHSZ_MEANING[z.level])}`)
                : row('good', 'Not in a mapped Fire Hazard Severity Zone', 'Wind-blown embers still reach homes outside the zones, so defensible space and ember-resistant vents still help.'));
        }
        if (air.status === 'fulfilled') {
            const outlook = airOutlook(air.value, Date.now());
            if (outlook) {
                const lvl = aqiLevel(outlook.now.aqi);
                rows.push(row(outlook.now.aqi > 150 ? 'bad' : outlook.now.aqi > 100 ? 'warn' : 'good', `Air quality ${Math.round(outlook.now.aqi)}: ${e(lvl.label)}`, e(lvl.advice)));
            }
        }
        if (power.status === 'fulfilled') {
            const { areas, points } = power.value;
            const inArea = areas.features.find((f) => pointInGeometry(coords, f.geometry));
            const nearPoint = points.features.find((f) => distanceMiles(f.geometry.coordinates, coords) < 1);
            const hit = inArea || nearPoint;
            rows.push(hit
                ? row(hit.properties.kind === 'psps' ? 'bad' : 'warn', `${e(hit.properties.status)} (${e(hit.properties.utility)})`, 'Power may be out here. Traffic signals and garage-door openers may not work.')
                : row('good', 'No power shutoffs or outages reported here'));
        }
        report.innerHTML = rows.join('') + nextStep;
    }

    function setPlace(coords, label) {
        state.place = { coords, label };
        state.picking = false;
        map.getCanvas().style.cursor = '';
        save(PLACE_KEY, state.place);
        marker.setLngLat(coords).addTo(map);
        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 11), duration: 1000 });
        render();
        if (/^-?\d/.test(label)) {
            placeName(coords).then((name) => {
                if (!name || state.place?.coords !== coords) return;
                state.place.label = `Near ${name}`;
                save(PLACE_KEY, state.place);
                const input = $('ready-q');
                if (input) input.value = state.place.label;
            });
        }
    }

    function setOpen(open) {
        if (open) onOpen();
        state.open = open;
        $('ready').hidden = !open;
        $('ready-open').hidden = open;
        map.getContainer().parentElement.classList.toggle('is-planning', open);
        if (open) {
            if (state.place) marker.setLngLat(state.place.coords).addTo(map);
            render();
        } else {
            marker.remove();
            state.picking = false;
            map.getCanvas().style.cursor = '';
        }
    }

    // --- events (delegated: the body is re-rendered per tab) ---
    $('ready-open').addEventListener('click', () => setOpen(true));
    $('ready-close').addEventListener('click', () => setOpen(false));
    $('ready-tabs').addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-tab]');
        if (!btn) return;
        state.tab = btn.dataset.tab;
        render();
    });
    $('ready-body').addEventListener('change', (ev) => {
        const id = ev.target.dataset.item;
        if (!id) return;
        if (ev.target.checked) state.done.add(id);
        else state.done.delete(id);
        save(DONE_KEY, [...state.done]);
        renderTabs();
    });
    let searchTimer = null;
    $('ready-body').addEventListener('input', (ev) => {
        if (ev.target.id !== 'ready-q') return;
        clearTimeout(searchTimer);
        const q = ev.target.value.trim();
        const list = $('ready-suggest');
        if (q.length < 3) {
            list.hidden = true;
            return;
        }
        searchTimer = setTimeout(async () => {
            const results = await searchPlaces(q, map.getCenter().toArray());
            list.innerHTML = results.map((r, i) => `<li><button data-place="${i}">${e(r.label)}</button></li>`).join('');
            list.hidden = !results.length;
            list.onclick = (click) => {
                const b = click.target.closest('[data-place]');
                if (b) setPlace(results[Number(b.dataset.place)].coords, results[Number(b.dataset.place)].label);
            };
        }, 300);
    });
    $('ready-body').addEventListener('click', (ev) => {
        const tab = ev.target.closest('[data-tab]');
        if (tab) {
            state.tab = tab.dataset.tab;
            render();
        } else if (ev.target.closest('#ready-locate')) {
            navigator.geolocation?.getCurrentPosition(
                (pos) => setPlace([pos.coords.longitude, pos.coords.latitude], 'My location'),
                () => {},
                { enableHighAccuracy: true, timeout: 10000 },
            );
        } else if (ev.target.closest('#ready-pick')) {
            state.picking = !state.picking;
            map.getCanvas().style.cursor = state.picking ? 'crosshair' : '';
            ev.target.closest('#ready-pick').classList.toggle('is-active', state.picking);
        } else if (ev.target.closest('#ready-plan') && state.place) {
            setOpen(false);
            onPlanFrom(state.place.coords, state.place.label);
        }
    });

    return {
        handleMapClick(lngLat) {
            if (!state.open || !state.picking) return false;
            const coords = [lngLat.lng, lngLat.lat];
            setPlace(coords, `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`);
            return true;
        },
        close() {
            if (state.open) setOpen(false);
        },
        // New data arrived; refresh the report if it's showing.
        refresh() {
            if (state.open && state.tab === 'place' && state.place) checkPlace();
        },
    };
}
