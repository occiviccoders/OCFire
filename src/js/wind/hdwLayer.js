import { HDW_STOPS, hotDryWindy } from './fireWeather.js';

const SCALE = 4; // canvas pixels per grid cell before MapLibre's linear resampling

function parseRGBA(css) {
    const [r, g, b, a] = css.match(/[\d.]+/g).map(Number);
    return [r, g, b, a * 255];
}

const STOPS = HDW_STOPS.map(([v, c]) => [v, parseRGBA(c)]);

function colorFor(value) {
    if (Number.isNaN(value) || value <= STOPS[0][0]) return [0, 0, 0, 0];
    for (let i = 1; i < STOPS.length; i++) {
        const [v1, c1] = STOPS[i];
        const [v0, c0] = STOPS[i - 1];
        if (value <= v1) {
            const t = (value - v0) / (v1 - v0);
            return c0.map((c, k) => c + (c1[k] - c) * t);
        }
    }
    return STOPS.at(-1)[1];
}

// Hot-Dry-Windy shading as a canvas image source stretched over the grid; MapLibre's linear
// raster resampling smooths the cells into a continuous field.
export function createHdwLayer(map, beforeId) {
    const canvas = document.createElement('canvas');
    let forecast = null;

    function corners() {
        const half = forecast.step / 2;
        const w = forecast.west - half;
        const e = forecast.west + (forecast.cols - 1) * forecast.step + half;
        const s = forecast.south - half;
        const n = forecast.south + (forecast.rows - 1) * forecast.step + half;
        return [[w, n], [e, n], [e, s], [w, s]];
    }

    function draw(hour) {
        const { cols, rows } = forecast;
        const small = new ImageData(cols, rows);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                const value = hotDryWindy(forecast.temp[hour][i], forecast.rh[hour][i], forecast.speed[hour][i]);
                // Image rows run north → south.
                small.data.set(colorFor(value), ((rows - 1 - r) * cols + c) * 4);
            }
        }
        const tmp = document.createElement('canvas');
        tmp.width = cols;
        tmp.height = rows;
        tmp.getContext('2d').putImageData(small, 0, 0);
        canvas.width = cols * SCALE;
        canvas.height = rows * SCALE;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    }

    // A non-animated canvas source only re-uploads the canvas while playing, so play for one frame.
    function upload() {
        const source = map.getSource('hdw');
        source.play();
        requestAnimationFrame(() => source.pause());
    }

    return {
        setForecast(newForecast, hour) {
            forecast = newForecast;
            draw(hour);
            if (map.getSource('hdw')) {
                map.getSource('hdw').setCoordinates(corners());
                upload();
                return;
            }
            map.addSource('hdw', { type: 'canvas', canvas, coordinates: corners(), animate: false });
            map.addLayer(
                {
                    id: 'hdw',
                    type: 'raster',
                    source: 'hdw',
                    layout: { visibility: 'none' },
                    paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0, 'raster-opacity': 0.85 },
                },
                beforeId,
            );
        },
        setHour(hour) {
            if (!forecast) return;
            draw(hour);
            upload();
        },
        setVisible(visible) {
            if (map.getLayer('hdw')) map.setLayoutProperty('hdw', 'visibility', visible ? 'visible' : 'none');
        },
    };
}
