import * as maplibregl from 'maplibre-gl';
import { containmentColor } from './explain.js';
import { compass, downwind } from './wind/fireWeather.js';
import { escapeHTML as e, formatAcres } from './util.js';

const COMPACT_BELOW_ZOOM = 6.5;

function windHTML(wind) {
    if (!wind) return '';
    // Arrow shows where the wind pushes the fire.
    return `
        <div class="fire-marker__wind fire-marker__wind--${wind.level}" title="Forecast wind at the fire: from the ${compass(wind.dir)}, pushing ${downwind(wind.dir)}">
            <span class="fire-marker__arrow" style="transform:rotate(${Math.round(wind.dir + 180)}deg)">↑</span>
            ${compass(wind.dir)} ${Math.round(wind.speed)}<small>/${Math.round(wind.gust)} mph</small>
        </div>`;
}

function markerHTML(p, wind) {
    const pct = p.contained == null ? null : Math.max(0, Math.min(100, p.contained));
    return `
        <div class="fire-marker__card">
            <div class="fire-marker__name">${e(p.name.replace(/\s+fire$/i, ''))}</div>
            <div class="fire-marker__meta">
                <span>${formatAcres(p.acres)}</span>
                <span class="fire-marker__pct">${pct == null ? '—' : `${Math.round(pct)}%`}</span>
            </div>
            <div class="fire-marker__meter${pct == null ? ' is-unknown' : ''}"><span style="width:${pct ?? 100}%"></span></div>
            ${windHTML(wind)}
        </div>
        <div class="fire-marker__stem"></div>
        <div class="fire-marker__pin"></div>`;
}

// CAL FIRE incidents as DOM callouts: pin on the origin point, a card with name, size and a
// containment meter. Below COMPACT_BELOW_ZOOM they collapse to pin + meter to avoid overlap.
export function createIncidentMarkers(map, onSelect) {
    const markers = new Map();
    let selectedId = null;

    const updateCompact = () => map.getContainer().classList.toggle('markers-compact', map.getZoom() < COMPACT_BELOW_ZOOM);
    map.on('zoom', updateCompact);
    updateCompact();

    function build() {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'fire-marker';
        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onSelect(el.dataset.id);
        });
        return new maplibregl.Marker({ element: el, anchor: 'bottom' });
    }

    // windAt(coords) → current forecast conditions at the fire, or null.
    function update(incidents, windAt = () => null) {
        const seen = new Set();
        incidents.features.forEach((f, i) => {
            const p = f.properties;
            seen.add(p.id);
            let marker = markers.get(p.id);
            if (!marker) {
                marker = build().setLngLat(f.geometry.coordinates).addTo(map);
                markers.set(p.id, marker);
            }
            const el = marker.getElement();
            el.dataset.id = p.id;
            el.style.setProperty('--fire-color', containmentColor(p.contained));
            // Nearest fires stack on top.
            el.style.zIndex = String(1000 - i);
            el.setAttribute('aria-label', `${p.name}: ${formatAcres(p.acres)}, ${p.contained ?? 'unknown'}% contained`);
            el.innerHTML = markerHTML(p, windAt(f.geometry.coordinates));
            el.classList.toggle('is-selected', p.id === selectedId);
            marker.setLngLat(f.geometry.coordinates);
        });
        for (const [id, marker] of markers) {
            if (!seen.has(id)) {
                marker.remove();
                markers.delete(id);
            }
        }
    }

    function setSelected(id) {
        selectedId = id;
        for (const [markerId, marker] of markers) marker.getElement().classList.toggle('is-selected', markerId === id);
    }

    function setVisible(visible) {
        map.getContainer().classList.toggle('markers-hidden', !visible);
    }

    return { update, setSelected, setVisible };
}
