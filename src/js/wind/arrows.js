import { LABEL_FONT } from '../config.js';
import { EMPTY_FC, featureCollection } from '../util.js';

export const WIND_SPEED_COLOR = [
    'interpolate', ['linear'], ['get', 'speed'],
    0, '#9fc3ff',
    10, '#ffffff',
    20, '#ffe08a',
    30, '#ff9a3c',
    40, '#ff3b1f',
];

function arrowImage() {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    // Points north; rotated per feature to the direction the wind is blowing toward.
    ctx.moveTo(24, 4);
    ctx.lineTo(36, 22);
    ctx.lineTo(28, 20);
    ctx.lineTo(28, 44);
    ctx.lineTo(20, 44);
    ctx.lineTo(20, 20);
    ctx.lineTo(12, 22);
    ctx.closePath();
    ctx.fill();
    return ctx.getImageData(0, 0, size, size);
}

export function addWindArrowLayer(map, beforeId) {
    map.addImage('wind-arrow', arrowImage(), { sdf: true, pixelRatio: 2 });
    map.addSource('wind-arrows', { type: 'geojson', data: EMPTY_FC });
    map.addLayer(
        {
            id: 'wind-arrows',
            type: 'symbol',
            source: 'wind-arrows',
            layout: {
                visibility: 'none',
                'icon-image': 'wind-arrow',
                'icon-rotate': ['+', ['get', 'dir'], 180],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.45, 15, 0.75, 35, 1.15],
                'text-field': ['step', ['zoom'], '', 8, ['concat', ['to-string', ['round', ['get', 'speed']]], '']],
                'text-font': LABEL_FONT,
                'text-size': 10,
                'text-offset': [0, 1.5],
                'text-allow-overlap': true,
            },
            paint: {
                'icon-color': WIND_SPEED_COLOR,
                'icon-opacity': 0.85,
                'text-color': WIND_SPEED_COLOR,
                'text-halo-color': 'rgba(0,0,0,0.8)',
                'text-halo-width': 1,
            },
        },
        beforeId,
    );
}

export function windArrowData(forecast, hour) {
    const features = [];
    for (let r = 0; r < forecast.rows; r++) {
        for (let c = 0; c < forecast.cols; c++) {
            const i = r * forecast.cols + c;
            const speed = forecast.speed[hour][i];
            if (Number.isNaN(speed)) continue;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [forecast.west + c * forecast.step, forecast.south + r * forecast.step] },
                properties: { speed, gust: forecast.gust[hour][i], dir: forecast.dir[hour][i] },
            });
        }
    }
    return featureCollection(features);
}
