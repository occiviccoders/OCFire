import { escapeHTML as e } from '../util.js';
import { aqiLevel, airOutlook } from '../sources/airQuality.js';
import { compass, riskWindows } from './fireWeather.js';

const W = 320;
const H = 96;
const PAD = { top: 8, right: 4, bottom: 16, left: 4 };

export function formatHour(ts, { withDay = true } = {}) {
    const d = new Date(ts);
    const hour = d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase();
    return withDay ? `${d.toLocaleDateString([], { weekday: 'short' })} ${hour}` : hour;
}

function describeWindow(series, w) {
    const range = `${formatHour(series[w.start].time)}–${formatHour(series[w.end].time + 3600000, { withDay: series[w.end].time - series[w.start].time > 20 * 3600000 })}`;
    return `${range}: ${compass(w.dir)} gusts to ${Math.round(w.maxGust)} mph, humidity down to ${Math.round(w.minRh)}%`;
}

function chartSVG(series, hour) {
    const n = series.length;
    const maxGust = Math.max(30, ...series.map((s) => s.gust || 0));
    const yMax = Math.ceil(maxGust / 10) * 10;
    const x = (i) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
    const y = (mph) => PAD.top + (1 - mph / yMax) * (H - PAD.top - PAD.bottom);
    const yRh = (rh) => PAD.top + (1 - rh / 100) * (H - PAD.top - PAD.bottom);
    const line = (fn) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${fn(s).toFixed(1)}`).join('');
    const baseY = y(0);

    const risk = series
        .map((s, i) => (s.level === 'normal' ? '' : `<rect class="risk risk--${s.level}" x="${x(Math.max(0, i - 0.5))}" y="${PAD.top}" width="${(W - PAD.left - PAD.right) / (n - 1)}" height="${baseY - PAD.top}"/>`))
        .join('');

    const days = series
        .map((s, i) => {
            const d = new Date(s.time);
            if (d.getHours() !== 0 || i === 0) return '';
            return `<line class="day" x1="${x(i)}" x2="${x(i)}" y1="${PAD.top}" y2="${baseY}"/><text class="axis" x="${x(i) + 3}" y="${H - 4}">${d.toLocaleDateString([], { weekday: 'short' })}</text>`;
        })
        .join('');

    return `
        <svg class="oc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="72-hour wind and humidity forecast">
            ${risk}${days}
            <path class="gust" d="${line((s) => y(s.gust))}L${x(n - 1)},${baseY}L${x(0)},${baseY}Z"/>
            <path class="rh" d="${line((s) => yRh(s.rh))}"/>
            <path class="speed" d="${line((s) => y(s.speed))}"/>
            <line class="cursor" x1="${x(hour)}" x2="${x(hour)}" y1="${PAD.top - 4}" y2="${baseY}"/>
            <text class="axis" x="${PAD.left}" y="${PAD.top + 8}">${yMax} mph</text>
        </svg>`;
}

function worstWindow(series) {
    const windows = riskWindows(series);
    return windows.find((w) => w.level === 'critical') || windows[0] || null;
}

function outlookHTML(series, w) {
    if (!w) return '<p class="oc-outlook">No dry offshore wind in the next 72 hours.</p>';
    const title = w.level === 'critical' ? 'Red-flag-level conditions' : 'Elevated fire weather';
    return `<p class="oc-outlook oc-outlook--${w.level}"><strong>${title}</strong> ${e(describeWindow(series, w))}</p>`;
}

function airHTML(series, time) {
    const outlook = airOutlook(series, time);
    if (!outlook) return '';
    const { now, peak } = outlook;
    const level = aqiLevel(now.aqi);
    const peakLevel = aqiLevel(peak.aqi);
    const worse = peakLevel !== level && peak.aqi > now.aqi;
    return `
        <div class="oc-air" style="--aqi-color:${level.color}">
            <span class="oc-air__badge">${Math.round(now.aqi)}</span>
            <div>
                <strong>Air quality: ${e(level.label)}</strong>
                <p>${e((worse ? peakLevel : level).advice)}</p>
                ${worse ? `<p class="oc-air__peak">Rising to ${Math.round(peak.aqi)} (${e(peakLevel.label.toLowerCase())}) by ${e(formatHour(peak.time))}.</p>` : ''}
            </div>
        </div>`;
}

const LEVEL_RANK = { critical: 2, elevated: 1 };

// points: [{ id, group, name, detail }], seriesById: { id: series }, airById: { id: [{ time, aqi }] }
export function renderOCForecast(el, points, seriesById, activeId, hour, airById = {}) {
    const series = seriesById[activeId];
    const s = series[hour];
    const active = points.find((p) => p.id === activeId);
    const windows = Object.fromEntries(points.map((p) => [p.id, worstWindow(seriesById[p.id])]));
    const own = windows[activeId];

    // Point out the riskiest other corridors (common: foothills windy while the coast is calm).
    const others = points
        .filter((p) => p.id !== activeId && windows[p.id])
        .sort((a, b) => LEVEL_RANK[windows[b.id].level] - LEVEL_RANK[windows[a.id].level] || windows[a.id].start - windows[b.id].start)
        .slice(0, 2);
    const elsewhere = others.length
        ? `<div class="oc-also"><span>Also watch</span>${others.map((p) => `<button class="oc-also__item oc-also__item--${windows[p.id].level}" data-oc-point="${p.id}"><strong>${e(p.name)}</strong> ${e(describeWindow(seriesById[p.id], windows[p.id]))}</button>`).join('')}</div>`
        : '';

    const groups = [...new Set(points.map((p) => p.group))];
    const optionLabel = (p) => {
        const w = windows[p.id];
        return w ? `${p.name} — ${w.level === 'critical' ? 'red-flag level' : 'elevated'} ${formatHour(series[w.start].time).split(' ')[0]}` : p.name;
    };

    el.innerHTML = `
        <div class="oc-pick">
            <select class="oc-select" data-oc-select aria-label="Forecast location">
                ${groups.map((g) => `<optgroup label="${e(g === 'Orange County' ? g : `${g} wind corridor`)}">${points.filter((p) => p.group === g).map((p) => `<option value="${p.id}"${p.id === activeId ? ' selected' : ''}>${e(optionLabel(p))}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <button class="chip" data-oc-fly title="Show this spot on the map">Map</button>
        </div>
        <div class="oc-place">${e(active.detail)}</div>
        <div class="oc-now">
            <div><span class="oc-now__value">${compass(s.dir)} ${Math.round(s.speed)}</span><span class="oc-now__unit">mph</span><span class="oc-now__label">wind</span></div>
            <div><span class="oc-now__value">${Math.round(s.gust)}</span><span class="oc-now__unit">mph</span><span class="oc-now__label">gusts</span></div>
            <div><span class="oc-now__value">${Math.round(s.rh)}</span><span class="oc-now__unit">%</span><span class="oc-now__label">humidity</span></div>
            <div><span class="oc-now__value">${Math.round(s.temp)}</span><span class="oc-now__unit">°F</span><span class="oc-now__label">temp</span></div>
        </div>
        ${chartSVG(series, hour)}
        <div class="oc-key"><span class="k-speed">wind</span><span class="k-gust">gusts</span><span class="k-rh">humidity</span><span class="k-risk">fire weather</span></div>
        ${outlookHTML(series, own)}
        ${airHTML(airById[activeId], s.time)}
        ${elsewhere}`;
}

// Clicking the chart jumps the forecast timeline to that hour.
export function chartHourFromEvent(ev, hours) {
    const svg = ev.target.closest('svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const t = (ev.clientX - rect.left - (PAD.left / W) * rect.width) / (rect.width * (1 - (PAD.left + PAD.right) / W));
    return Math.max(0, Math.min(hours - 1, Math.round(t * (hours - 1))));
}
