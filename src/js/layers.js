import { BASEMAPS, LABEL_FONT } from './config.js';
import { EMPTY_FC } from './util.js';

const containment = ['coalesce', ['get', 'contained'], 0];

// Active fires read hot (red), nearly-contained fade to amber, fully contained go neutral.
const containmentColor = [
    'interpolate', ['linear'], containment,
    0, '#ff3b1f',
    60, '#ff9f1c',
    99, '#ffd166',
    100, '#8b95a1',
];

const fireWeatherColor = ['match', ['get', 'event'], 'Red Flag Warning', '#ff2d78', '#ffc93c'];

// Toggle groups exposed to the UI.
export const LAYER_GROUPS = {
    perimeters: [
        'perimeters-fill', 'perimeters-tint', 'perimeters-hatch', 'perimeter-history-line', 'perimeters-glow',
        'perimeters-active-edge', 'perimeters-line', 'perimeters-selected', 'perimeters-label',
    ],
    hotspots: ['hotspots-goes', 'hotspots-glow', 'hotspots-core', 'heat-pulse', 'heat-ring'],
    persistent: ['persistent-goes', 'persistent-glow', 'persistent-core', 'heat-persistent'],
    fireWeather: ['fireweather-fill', 'fireweather-line'],
    smoke: ['smoke-fill', 'smoke-line'],
    fhsz: ['fhsz-fill', 'fhsz-line'],
    power: ['power-fill', 'power-line', 'power-points'],
};

// Off until toggled on in the sidebar.
export const HIDDEN_BY_DEFAULT = ['smoke', 'fhsz', 'power'];

export function addBasemapLayers(map) {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('satellite', {
        type: 'raster',
        tiles: [BASEMAPS.satelliteTiles],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    map.addLayer(
        { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.75 } },
        firstSymbol,
    );
}

export function addFireLayers(map) {
    for (const id of ['fireweather', 'perimeter-history', 'perimeters', 'perimeter-labels', 'hotspots']) {
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
    }
    map.addImage('burn-hatch', hatchPattern(), { pixelRatio: 2 });

    map.addLayer({
        id: 'fireweather-fill',
        type: 'fill',
        source: 'fireweather',
        paint: { 'fill-color': fireWeatherColor, 'fill-opacity': 0.07 },
    });
    map.addLayer({
        id: 'fireweather-line',
        type: 'line',
        source: 'fireweather',
        paint: { 'line-color': fireWeatherColor, 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    });

    // Burn scar: dark ember base, tinted by containment, with a hatch so it reads as burned ground
    // rather than a flat highlight on both the dark and satellite basemaps.
    map.addLayer({
        id: 'perimeters-fill',
        type: 'fill',
        source: 'perimeters',
        paint: {
            'fill-color': ['interpolate', ['linear'], containment, 0, '#5a0e00', 100, '#2a2d33'],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 12, 0.45],
        },
    });
    map.addLayer({
        id: 'perimeters-tint',
        type: 'fill',
        source: 'perimeters',
        paint: { 'fill-color': containmentColor, 'fill-opacity': 0.16 },
    });
    map.addLayer({
        id: 'perimeters-hatch',
        type: 'fill',
        source: 'perimeters',
        minzoom: 9,
        paint: { 'fill-pattern': 'burn-hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 11, 0.32] },
    });

    // Growth rings: earlier mapped perimeters, faint and dashed, darker the older they are.
    map.addLayer({
        id: 'perimeter-history-line',
        type: 'line',
        source: 'perimeter-history',
        minzoom: 9,
        layout: { 'line-join': 'round' },
        paint: {
            'line-color': ['interpolate', ['linear'], ['get', 'age'], 0, '#ffe2b0', 1, '#ff7a45'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1.4],
            'line-dasharray': [3, 2],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10.5, ['interpolate', ['linear'], ['get', 'age'], 0, 0.85, 1, 0.5]],
        },
    });

    // Outer heat haze, then a pulsing edge for fires that are still burning, then the crisp boundary.
    map.addLayer({
        id: 'perimeters-glow',
        type: 'line',
        source: 'perimeters',
        layout: { 'line-join': 'round' },
        paint: {
            'line-color': containmentColor,
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 18],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 14],
            'line-opacity': 0.35,
        },
    });
    map.addLayer({
        id: 'perimeters-active-edge',
        type: 'line',
        source: 'perimeters',
        filter: ['<', containment, 100],
        layout: { 'line-join': 'round' },
        paint: {
            'line-color': '#ffcf6b',
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 6],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 4],
            'line-opacity': 0.5,
        },
    });
    map.addLayer({
        id: 'perimeters-line',
        type: 'line',
        source: 'perimeters',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': ['interpolate', ['linear'], containment, 0, '#ff6a3d', 60, '#ffb347', 99, '#ffe08a', 100, '#b8c0c8'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 2.5],
        },
    });
    map.addLayer(
        {
            id: 'perimeters-selected',
            type: 'line',
            source: 'perimeters',
            filter: ['==', ['get', 'incidentId'], ''],
            layout: { 'line-join': 'round' },
            paint: {
                'line-color': '#fff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 12, 12],
                'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 8],
                'line-opacity': 0.55,
            },
        },
        'perimeters-glow',
    );

    // GOES pixels are ~2 km across: a soft wide disc, so it doesn't read as a precise point.
    map.addLayer({
        id: 'hotspots-goes',
        type: 'circle',
        source: 'hotspots',
        filter: ['all', ['==', ['get', 'goes'], true], ['!=', ['get', 'persistent'], true]],
        paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 2.5, 10, 8, 14, 128],
            'circle-color': '#ffb347',
            'circle-opacity': 0.14,
            'circle-stroke-color': '#ffb347',
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.55,
        },
    });
    map.addLayer({
        id: 'hotspots-glow',
        type: 'circle',
        source: 'hotspots',
        filter: ['all', ['!=', ['get', 'goes'], true], ['!=', ['get', 'persistent'], true]],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 16],
            'circle-color': '#ff5a1f',
            'circle-blur': 1,
            'circle-opacity': 0.5,
        },
    });
    map.addLayer({
        id: 'hotspots-core',
        type: 'circle',
        source: 'hotspots',
        filter: ['all', ['!=', ['get', 'goes'], true], ['!=', ['get', 'persistent'], true]],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 4.5],
            'circle-color': ['interpolate', ['linear'], ['get', 'frp'], 0, '#ffe08a', 10, '#ff9a3c', 50, '#ff2a1a'],
        },
    });

    // Known fixed sources (flares, plants, landfills), drawn gray and toggled separately from hotspots.
    const persistentPoint = ['all', ['!=', ['get', 'goes'], true], ['==', ['get', 'persistent'], true]];
    map.addLayer({
        id: 'persistent-goes',
        type: 'circle',
        source: 'hotspots',
        filter: ['all', ['==', ['get', 'goes'], true], ['==', ['get', 'persistent'], true]],
        paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 2.5, 10, 8, 14, 128],
            'circle-color': '#8b95a1',
            'circle-opacity': 0.16,
            'circle-stroke-color': '#8b95a1',
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.7,
        },
    });
    map.addLayer({
        id: 'persistent-glow',
        type: 'circle',
        source: 'hotspots',
        filter: persistentPoint,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 16],
            'circle-color': '#8b95a1',
            'circle-blur': 1,
            'circle-opacity': 0.35,
        },
    });
    map.addLayer({
        id: 'persistent-core',
        type: 'circle',
        source: 'hotspots',
        filter: persistentPoint,
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 4.5],
            'circle-color': '#c5ced6',
        },
    });

    map.addLayer({
        id: 'perimeters-label',
        type: 'symbol',
        source: 'perimeter-labels',
        minzoom: 9,
        layout: {
            'text-field': ['get', 'name'],
            'text-font': LABEL_FONT,
            'text-size': 12,
            'text-transform': 'uppercase',
            'text-letter-spacing': 0.08,
        },
        paint: { 'text-color': '#ffd9c7', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5 },
    });
}

// Context layers drawn under the fire layers: hazard zones, power shutoffs, smoke; plus candidate
// new fires on top of the hotspots.
export function addHazardLayers(map) {
    for (const id of ['smoke', 'fhsz', 'power-areas', 'power-points', 'unmatched-heat']) {
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
    }
    const fhszColor = ['match', ['get', 'fhsz'], 3, '#d7301f', 2, '#f08c2e', '#f2d64b'];
    const powerColor = ['match', ['get', 'kind'], 'psps', '#a46bff', '#6fb6ff'];
    const below = 'fireweather-fill';

    map.addLayer({ id: 'fhsz-fill', type: 'fill', source: 'fhsz', paint: { 'fill-color': fhszColor, 'fill-opacity': 0.22 } }, below);
    map.addLayer({ id: 'fhsz-line', type: 'line', source: 'fhsz', paint: { 'line-color': fhszColor, 'line-width': 0.6, 'line-opacity': 0.6 } }, below);
    map.addLayer({ id: 'power-fill', type: 'fill', source: 'power-areas', paint: { 'fill-color': powerColor, 'fill-opacity': 0.22 } }, below);
    map.addLayer({ id: 'power-line', type: 'line', source: 'power-areas', paint: { 'line-color': powerColor, 'line-width': 1.4 } }, below);
    map.addLayer({
        id: 'smoke-fill',
        type: 'fill',
        source: 'smoke',
        paint: { 'fill-color': ['match', ['get', 'level'], 3, '#8a7a6a', 2, '#a99c8c', '#c8beb2'], 'fill-opacity': ['match', ['get', 'level'], 3, 0.45, 2, 0.3, 0.16] },
    }, below);
    map.addLayer({ id: 'smoke-line', type: 'line', source: 'smoke', paint: { 'line-color': '#d8cfc4', 'line-width': 0.8, 'line-opacity': 0.4 } }, below);
    map.addLayer({
        id: 'power-points',
        type: 'circle',
        source: 'power-points',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'customers'], 1, 3, 1000, 7, 10000, 12],
            'circle-color': powerColor,
            'circle-opacity': 0.75,
            'circle-stroke-color': '#0d0f12',
            'circle-stroke-width': 1,
        },
    }, 'hotspots-glow');

    // Unconfirmed heat: a ring around heat that no known fire explains, colored by alert level.
    // Only Moderate and Elevated pulse.
    const byLevel = (high, moderate, low) => ['match', ['get', 'unusual'], 'high', high, 'moderate', moderate, low];
    map.addLayer({
        id: 'heat-pulse',
        type: 'circle',
        source: 'unmatched-heat',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 30],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': ['match', ['get', 'unusual'], 'high', '#ff2d78', '#ffc93c'],
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.6,
        },
        filter: ['all', ['!=', ['get', 'strength'], 'persistent'], ['in', ['get', 'unusual'], ['literal', ['high', 'moderate']]]],
    }, 'perimeters-label');
    map.addLayer({
        id: 'heat-ring',
        type: 'circle',
        source: 'unmatched-heat',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 12, 16],
            'circle-color': byLevel('rgba(255,45,120,0.18)', 'rgba(255,201,60,0.14)', 'rgba(255,201,60,0.05)'),
            'circle-stroke-color': byLevel('#ff2d78', '#ffc93c', 'rgba(255,201,60,0.55)'),
            'circle-stroke-width': 1.5,
        },
        filter: ['!=', ['get', 'strength'], 'persistent'],
    }, 'perimeters-label');
    map.addLayer({
        id: 'heat-persistent',
        type: 'circle',
        source: 'unmatched-heat',
        filter: ['==', ['get', 'strength'], 'persistent'],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 12, 16],
            'circle-color': 'rgba(139,149,161,0.12)',
            'circle-stroke-color': '#8b95a1',
            'circle-stroke-width': 1.5,
        },
    }, 'perimeters-label');

    for (const group of HIDDEN_BY_DEFAULT) setGroupVisibility(map, group, false);
}

// Expanding ring on Moderate and Elevated unconfirmed heat so it catches the eye.
export function animateHeatPulse(map) {
    let last = 0;
    const tick = (t) => {
        if (t - last > 50 && map.getLayer('heat-pulse') && map.getLayoutProperty('heat-pulse', 'visibility') !== 'none') {
            last = t;
            const phase = (t % 2000) / 2000;
            const base = map.getZoom() < 8 ? 10 : 22;
            map.setPaintProperty('heat-pulse', 'circle-radius', base + phase * base * 1.4);
            map.setPaintProperty('heat-pulse', 'circle-stroke-opacity', 0.7 * (1 - phase));
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

export function setGroupVisibility(map, group, visible) {
    for (const id of LAYER_GROUPS[group] || []) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
}

export function setSatellite(map, enabled) {
    map.setLayoutProperty('satellite', 'visibility', enabled ? 'visible' : 'none');
}

export function setSelectedIncident(map, id) {
    map.setFilter('perimeters-selected', ['==', ['get', 'incidentId'], id || '']);
}

// Slow "breathing" on the edge of uncontained fires.
export function animateActiveEdge(map) {
    let last = 0;
    const tick = (t) => {
        if (t - last > 60 && map.getLayer('perimeters-active-edge')) {
            last = t;
            const phase = (Math.sin(t / 700) + 1) / 2;
            map.setPaintProperty('perimeters-active-edge', 'line-opacity', 0.2 + phase * 0.55);
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function hatchPattern() {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(255, 190, 150, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Diagonal lines, drawn three times so the pattern tiles seamlessly.
    for (const offset of [-size, 0, size]) {
        ctx.moveTo(offset, size);
        ctx.lineTo(offset + size, 0);
    }
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
}
