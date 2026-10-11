import { sampleField } from '../sources/weather.js';

const PARTICLE_COUNT = 1400; // at REFERENCE_SIZE; scaled by map area
const REFERENCE_SIZE = 1400 * 900;
const MAX_AGE = 80; // 60 fps frames
const PX_PER_MPH_PER_FRAME = 0.08; // per 60 fps frame on a REFERENCE_WIDTH map
const REFERENCE_WIDTH = 1100;
const FADE = 0.9; // per 60 fps frame
const FRAME_MS = 1000 / 60;

// Speed buckets (mph) so each frame is a handful of batched strokes instead of one per particle.
// Light wind stays faint so it doesn't compete with the fire layers; strong wind gets loud.
const BUCKETS = [
    [5, 'rgba(150, 190, 255, 0.22)'],
    [10, 'rgba(200, 225, 255, 0.32)'],
    [15, 'rgba(255, 255, 255, 0.45)'],
    [25, 'rgba(255, 224, 138, 0.7)'],
    [35, 'rgba(255, 154, 60, 0.85)'],
    [Infinity, 'rgba(255, 59, 31, 0.95)'],
];

// Animated wind streaks drawn on a 2D canvas layered between the map and the DOM markers.
// Particles live in lng/lat so they stay put while the map pans; trails are cleared on move.
export class WindParticles {
    constructor(map) {
        this.map = map;
        this.forecast = null;
        this.hour = 0;
        this.visible = true;
        this.particles = [];

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'wind-canvas';
        map.getCanvasContainer().insertBefore(this.canvas, map.getCanvas().nextSibling);
        this.ctx = this.canvas.getContext('2d');

        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        map.on('resize', this.resize);
        map.on('move', () => this.clear());
        this.resize();
        requestAnimationFrame(this.frame);
    }

    setForecast(forecast) {
        this.forecast = forecast;
        this.particles = [];
    }

    setHour(hour) {
        this.hour = hour;
    }

    setVisible(visible) {
        this.visible = visible;
        this.canvas.style.display = visible ? '' : 'none';
        if (!visible) this.clear();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const { clientWidth: w, clientHeight: h } = this.map.getContainer();
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = w;
        this.height = h;
        this.particles = [];
    }

    clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        for (const p of this.particles) p.screen = null;
    }

    // Spawn area: visible map ∩ forecast grid.
    spawnBounds() {
        const f = this.forecast;
        const b = this.map.getBounds();
        const west = Math.max(b.getWest(), f.west);
        const east = Math.min(b.getEast(), f.west + (f.cols - 1) * f.step);
        const south = Math.max(b.getSouth(), f.south);
        const north = Math.min(b.getNorth(), f.south + (f.rows - 1) * f.step);
        return west < east && south < north ? { west, east, south, north } : null;
    }

    spawn(p, bounds) {
        p.lng = bounds.west + Math.random() * (bounds.east - bounds.west);
        p.lat = bounds.south + Math.random() * (bounds.north - bounds.south);
        p.age = Math.floor(Math.random() * MAX_AGE);
        p.screen = null;
    }

    frame(now) {
        requestAnimationFrame(this.frame);
        // Advance by elapsed time, not frames, so 120 Hz phones don't run at double speed.
        const ticks = this.lastFrame ? Math.min((now - this.lastFrame) / FRAME_MS, 3) : 1;
        this.lastFrame = now;
        if (!this.visible || !this.forecast || this.map.isMoving()) return;

        const bounds = this.spawnBounds();
        if (!bounds) return;
        if (!this.particles.length) {
            const count = Math.round(PARTICLE_COUNT * Math.min(1, Math.max(0.3, (this.width * this.height) / REFERENCE_SIZE)));
            this.particles = Array.from({ length: count }, () => {
                const p = {};
                this.spawn(p, bounds);
                return p;
            });
        }

        const ctx = this.ctx;
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = `rgba(0, 0, 0, ${FADE ** ticks})`;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.globalCompositeOperation = 'source-over';

        // Keep on-screen speed constant across zoom levels, and proportional to map width so
        // streaks cross a phone screen at the same pace as a desktop one.
        const degPerPx = 360 / (512 * 2 ** this.map.getZoom());
        const sizeScale = Math.min(1, Math.max(0.4, this.width / REFERENCE_WIDTH));
        const step = PX_PER_MPH_PER_FRAME * sizeScale * ticks * degPerPx;
        const { u, v } = this.forecast;
        const paths = BUCKETS.map(() => new Path2D());

        for (const p of this.particles) {
            if ((p.age += ticks) > MAX_AGE) this.spawn(p, bounds);
            const pu = sampleField(this.forecast, u, this.hour, p.lng, p.lat);
            const pv = sampleField(this.forecast, v, this.hour, p.lng, p.lat);
            if (Number.isNaN(pu) || Number.isNaN(pv) || p.lat < bounds.south || p.lat > bounds.north || p.lng < bounds.west || p.lng > bounds.east) {
                this.spawn(p, bounds);
                continue;
            }
            const from = p.screen || this.map.project([p.lng, p.lat]);
            p.lng += (pu * step) / Math.cos((p.lat * Math.PI) / 180);
            p.lat += pv * step;
            const to = this.map.project([p.lng, p.lat]);
            p.screen = to;

            const speed = Math.hypot(pu, pv);
            const b = BUCKETS.findIndex(([max]) => speed < max);
            paths[b].moveTo(from.x, from.y);
            paths[b].lineTo(to.x, to.y);
        }

        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        BUCKETS.forEach(([, color], i) => {
            ctx.strokeStyle = color;
            ctx.stroke(paths[i]);
        });
    }
}
