import { escapeHTML as e, formatAcres, formatDateTime, formatPercent, formatMiles, timeAgo } from './util.js';
import { containmentColor, containmentStage, summarize } from './explain.js';
import { compass, downwind } from './wind/fireWeather.js';
import { FHSZ_MEANING } from './sources/fhsz.js';

function containmentBar(pct) {
    const width = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    return `<div class="contain-bar"><span style="width:${width}%"></span></div>`;
}

function fireWindHTML(outlook) {
    if (!outlook) return '';
    const { now, peak } = outlook;
    const when = new Date(now.time).toLocaleString([], { weekday: 'short', hour: 'numeric' });
    const peakWhen = new Date(peak.time).toLocaleString([], { weekday: 'short', hour: 'numeric' });
    const flag = now.level === 'critical' ? 'Red-flag-level wind and humidity at the fire. '
        : now.level === 'elevated' ? 'Elevated fire weather at the fire. ' : '';
    return `
        <div class="popup__wind popup__wind--${now.level}">
            <span class="popup__wind-arrow" style="transform:rotate(${Math.round(now.dir + 180)}deg)">↑</span>
            <p>
                <strong>Wind ${e(when)}:</strong> ${flag}From the ${compass(now.dir)} at ${Math.round(now.speed)} mph, gusts ${Math.round(now.gust)},
                humidity ${Math.round(now.rh)}% — pushing the fire toward the <strong>${downwind(now.dir)}</strong>.
                ${peak.gust > now.gust + 3 ? `<br>Strongest in the following 24h: gusts to ${Math.round(peak.gust)} mph from the ${compass(peak.dir)} (${e(peakWhen)}).` : ''}
            </p>
        </div>`;
}

function camerasHTML(cameras) {
    if (cameras === null) return '<p class="popup__meta">Loading nearby wildfire cameras…</p>';
    if (!cameras?.length) return '';
    return `
        <div class="popup__cams">
            <div class="popup__cams-title">Live cameras · ALERTCalifornia / UC San Diego</div>
            <div class="popup__cams-row">
                ${cameras.map((c) => `
                    <a class="cam" href="${e(c.frame)}" target="_blank" rel="noopener" title="${e(c.name)} — open latest full-size frame">
                        <img src="${e(c.thumb)}" alt="${e(c.name)}" loading="lazy">
                        <span>${c.pointed ? '<b>Facing fire</b> · ' : ''}${e(c.name)} · ${Math.round(c.miles)} mi</span>
                    </a>`).join('')}
            </div>
        </div>`;
}

export function incidentPopup(p, windOutlook = null, cameras) {
    const [sizeLine, stageLine, timeLine] = summarize(p);
    const stage = containmentStage(p.contained);
    return `
        <div class="popup" style="--fire-color:${containmentColor(p.contained)}">
            <div class="popup__eyebrow">${e(p.type || 'Incident')} · ${e(p.county || '')} County</div>
            <h3 class="popup__title">${e(p.name)}</h3>
            <dl class="popup__stats">
                <div><dt>Size</dt><dd>${formatAcres(p.acres)}</dd></div>
                <div><dt>Contained</dt><dd>${formatPercent(p.contained)}</dd></div>
                <div><dt>From OC</dt><dd>${formatMiles(p.distance)}</dd></div>
            </dl>
            <div class="popup__stage">
                <span class="popup__stage-label">${e(stage.label)}</span>
                ${containmentBar(p.contained)}
            </div>
            <p class="popup__summary">${e(sizeLine)}</p>
            <p class="popup__summary">${e(stageLine)}</p>
            ${fireWindHTML(windOutlook)}
            ${camerasHTML(cameras)}
            <details class="popup__explain">
                <summary>What does “contained” mean?</summary>
                Containment is the share of the fire’s edge where crews have a finished control line — a dozer
                or hand line, or a natural barrier — that they expect to hold. It isn’t how much has been put out:
                a fully contained fire can keep burning inside its lines.
            </details>
            <p class="popup__meta">${e(timeLine)}${p.adminUnit ? `<br>${e(p.adminUnit)}` : ''}</p>
            ${p.url ? `<a class="popup__link" href="${e(p.url)}" target="_blank" rel="noopener">CAL FIRE incident page →</a>` : ''}
        </div>`;
}

export function perimeterPopup(p) {
    return `
        <div class="popup">
            <div class="popup__eyebrow">${p.prescribed ? 'Prescribed burn' : 'Fire perimeter'}${p.county ? ` · ${e(p.county)} County` : ''}</div>
            <h3 class="popup__title">${e(p.name)}</h3>
            <dl class="popup__stats">
                <div><dt>Mapped</dt><dd>${formatAcres(p.acres)}</dd></div>
                <div><dt>Contained</dt><dd>${formatPercent(p.contained)}</dd></div>
                ${p.personnel ? `<div><dt>Personnel</dt><dd>${Number(p.personnel).toLocaleString()}</dd></div>` : ''}
            </dl>
            ${containmentBar(p.contained)}
            <p class="popup__meta">Perimeter mapped ${timeAgo(p.updated)}${p.source ? ` by ${e(p.source)}` : ''}${p.cause ? ` · Cause: ${e(p.cause)}` : ''}</p>
        </div>`;
}

export function hotspotPopup(p) {
    return `
        <div class="popup">
            <div class="popup__eyebrow">Satellite detection · ${e(p.instrument)} (${e(p.satellite)})</div>
            <h3 class="popup__title">Thermal hotspot</h3>
            <dl class="popup__stats">
                <div><dt>Fire power</dt><dd>${p.frp.toFixed(1)} MW</dd></div>
                <div><dt>Confidence</dt><dd>${e(p.confidence)}</dd></div>
                <div><dt>Pass</dt><dd>${p.daynight === 'D' ? 'Day' : 'Night'}</dd></div>
            </dl>
            <p class="popup__meta">Detected ${timeAgo(p.acquired)}</p>
        </div>`;
}

export function fireWeatherPopup(p) {
    const ends = p.ends ? new Date(p.ends).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    return `
        <div class="popup popup--${p.event === 'Red Flag Warning' ? 'redflag' : 'watch'}">
            <div class="popup__eyebrow">${e(p.sender || 'National Weather Service')}</div>
            <h3 class="popup__title">${e(p.event)}</h3>
            <p class="popup__sub">${e(p.areaDesc)}</p>
            ${ends ? `<p class="popup__meta">In effect until ${e(ends)}</p>` : ''}
        </div>`;
}

const SIGNAL = {
    high: ['Strong', 'Several signs point to a real, active fire.'],
    moderate: ['Moderate', 'Some signs point to a real fire, but it isn’t confirmed.'],
    low: ['Weak', 'Few signs of a real fire so far. Single detections are often burn piles, farm burns, or sensor glitches.'],
};

function reasonList(title, items) {
    if (!items.length) return '';
    return `
        <div class="popup__reasons-title">${title}</div>
        <ul class="popup__reasons">${items.map((r) => `<li class="reason--${r.tone}">${e(r.text)}</li>`).join('')}</ul>`;
}

function unusualHTML(p) {
    if (!p.unusual) return '';
    const reasons = typeof p.reasons === 'string' ? JSON.parse(p.reasons) : p.reasons || [];
    const [label, summary] = SIGNAL[p.unusual];
    return `
        <div class="popup__unusual popup__unusual--${p.unusual}">
            <div class="popup__unusual-head">Fire signal: <strong>${label}</strong></div>
            <p class="popup__unusual-summary">${summary}</p>
            ${reasonList('Points toward a fire', reasons.filter((r) => r.tone === 'alert' || r.tone === 'watch'))}
            ${reasonList('Points against', reasons.filter((r) => r.tone === 'calm' || r.tone === 'info'))}
            <p class="popup__fine">Based on satellite history, detections and weather. A rough ranking, not a probability.</p>
        </div>`;
}

function detectionRecordHTML(p, coords) {
    const where = coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : '';
    return `
        <dl class="popup__record">
            <div><dt>First pass</dt><dd>${e(formatDateTime(p.first))}</dd></div>
            <div><dt>Latest pass</dt><dd>${e(formatDateTime(p.latest))}</dd></div>
            ${where ? `<div><dt>Location</dt><dd>${where} <button class="link-btn popup__copy" data-copy="${where}">Copy</button></dd></div>` : ''}
            ${where ? `<div><dt>History</dt><dd><a href="/lab?near=${coords[1].toFixed(4)},${coords[0].toFixed(4)}">Track timeline in the Model lab</a></dd></div>` : ''}
        </dl>`;
}

export function heatPopup(p, cameras, coords) {
    if (p.strength === 'persistent') {
        return `
            <div class="popup">
                <div class="popup__eyebrow">Satellite heat · recurring</div>
                <h3 class="popup__title">Persistent heat source</h3>
                <p class="popup__summary">Satellites saw heat here on ${p.priorDays} of the previous 5 days, so this is most likely a fixed source — a refinery flare, power plant, or landfill — rather than a new fire.</p>
                <p class="popup__meta">${p.count} detection${p.count === 1 ? '' : 's'} today, latest ${timeAgo(p.latest)}.</p>
                ${detectionRecordHTML(p, coords)}
            </div>`;
    }
    const likely = p.strength === 'likely';
    return `
        <div class="popup popup--${likely ? 'redflag' : 'watch'}">
            <div class="popup__eyebrow">Satellite heat · not matched to a known fire</div>
            <h3 class="popup__title">${likely ? 'Likely new fire' : 'Possible new fire'}</h3>
            <dl class="popup__stats">
                <div><dt>Detections</dt><dd>${p.count}</dd></div>
                <div><dt>Satellites</dt><dd>${p.satellites}</dd></div>
                <div><dt>Peak power</dt><dd>${Number(p.maxFrp).toFixed(0)} MW</dd></div>
            </dl>
            <p class="popup__summary">First seen ${timeAgo(p.first)}, latest ${timeAgo(p.latest)}. No CAL FIRE incident or mapped perimeter within 5 miles.</p>
            ${unusualHTML(p)}
            ${detectionRecordHTML(p, coords)}
            <p class="popup__meta">Could be a new fire not yet reported, an agricultural or prescribed burn, or an industrial heat source. Nearby cameras, if any, are listed below.</p>
            ${camerasHTML(cameras)}
        </div>`;
}

export function smokePopup(p) {
    return `
        <div class="popup">
            <div class="popup__eyebrow">NOAA Hazard Mapping System · ${e(p.day)}</div>
            <h3 class="popup__title">${e(p.density)} smoke</h3>
            <p class="popup__summary">Smoke traced from satellite imagery. It may be high aloft rather than at ground level — check the air-quality reading in the sidebar for what you’re breathing.</p>
        </div>`;
}

export function fhszPopup(p) {
    return `
        <div class="popup">
            <div class="popup__eyebrow">CAL FIRE Fire Hazard Severity Zone</div>
            <h3 class="popup__title">${e(p.label)} hazard</h3>
            <p class="popup__sub">${e(p.area)}</p>
            <p class="popup__summary">${e(FHSZ_MEANING[p.fhsz] || '')}</p>
            <p class="popup__meta">Zones rate long-term hazard from fuels, terrain and weather — not today’s fire risk.</p>
        </div>`;
}

export function powerPopup(p) {
    const restore = p.restore ? new Date(p.restore).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    return `
        <div class="popup">
            <div class="popup__eyebrow">${e(p.utility)}${p.county ? ` · ${e(p.county)} County` : ''}</div>
            <h3 class="popup__title">${e(p.status)}</h3>
            ${p.name ? `<p class="popup__sub">${e(p.name)}</p>` : ''}
            <dl class="popup__stats">
                <div><dt>Customers</dt><dd>${Number(p.customers || 0).toLocaleString()}</dd></div>
                ${restore ? `<div><dt>Est. restore</dt><dd>${e(restore)}</dd></div>` : ''}
            </dl>
            ${p.detail ? `<p class="popup__meta">${e(p.detail)}</p>` : ''}
            ${p.kind === 'psps' ? '<p class="popup__meta">Utilities cut power to lines in high wind so they can’t spark fires. Expect traffic signals and well pumps to be out too.</p>' : ''}
        </div>`;
}
