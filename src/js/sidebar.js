import { escapeHTML as e, formatAcres, formatMiles, formatPercent, timeAgo } from './util.js';

const $ = (sel) => document.querySelector(sel);

export function renderStats(incidents, hotspotCount) {
    const list = incidents.features.map((f) => f.properties);
    const acres = list.reduce((sum, p) => sum + (p.acres || 0), 0);
    const nearest = incidents.features[0]?.properties;

    $('#stat-count').textContent = list.length;
    $('#stat-acres').textContent = formatAcres(acres).replace(' ac', '');
    $('#stat-nearest').textContent = nearest ? formatMiles(nearest.distance) : '—';
    $('#stat-nearest-name').textContent = nearest ? nearest.name : 'No active fires';
    $('#stat-hotspots').textContent = hotspotCount == null ? '—' : hotspotCount.toLocaleString();
}

// Fade the bottom edge only while more cards are hidden below.
function updateListFade(ul) {
    ul.classList.toggle('has-more', ul.scrollTop + ul.clientHeight < ul.scrollHeight - 4);
}

function incidentItem(p, selectedId) {
    const pct = p.contained == null ? 0 : Math.max(0, Math.min(100, p.contained));
    const heat = p.contained >= 100 ? 'out' : pct >= 60 ? 'warm' : 'hot';
    return `
        <li>
            <button class="incident incident--${heat}${p.id === selectedId ? ' is-selected' : ''}" data-id="${e(p.id)}">
                <div class="incident__top">
                    <span class="incident__name">${e(p.name)}</span>
                    <span class="incident__dist">${formatMiles(p.distance)}</span>
                </div>
                <div class="incident__where">${e(p.county)} County${p.location ? ` · ${e(p.location)}` : ''}</div>
                <div class="incident__nums">
                    <span>${formatAcres(p.acres)}</span>
                    <span>${formatPercent(p.contained)} contained</span>
                    <span class="incident__updated">${timeAgo(p.updated)}</span>
                </div>
                <div class="contain-bar"><span style="width:${pct}%"></span></div>
            </button>
        </li>`;
}

function heatItem(p) {
    return `
        <li>
            <button class="incident incident--heat incident--heat-${p.strength}" data-heat="${e(p.id)}">
                <div class="incident__top">
                    <span class="incident__name">${p.strength === 'likely' ? 'Likely' : 'Possible'} new fire</span>
                    <span class="incident__dist">${formatMiles(p.distance)}</span>
                </div>
                <div class="incident__nums">
                    <span>${p.count} satellite detection${p.count === 1 ? '' : 's'}</span>
                    ${p.unusual === 'high' || p.unusual === 'moderate' ? `<span class="incident__unusual incident__unusual--${p.unusual}">${p.unusual === 'high' ? 'Strong signal' : 'Moderate signal'}</span>` : ''}
                    <span class="incident__updated">${timeAgo(p.latest)}</span>
                </div>
            </button>
        </li>`;
}

// `heat`: unmatched satellite heat clusters (see earlyDetection.js), listed after the incidents.
export function renderIncidentList(incidents, selectedId, onSelect, heat = null, onSelectHeat = () => {}) {
    const list = incidents.features.map((f) => f.properties);
    const heatList = (heat?.features || [])
        .map((f) => f.properties)
        .filter((p) => p.strength !== 'persistent');
    const ul = $('#incident-list');
    if (!ul.dataset.fadeWired) {
        ul.dataset.fadeWired = '1';
        ul.addEventListener('scroll', () => updateListFade(ul), { passive: true });
        new ResizeObserver(() => updateListFade(ul)).observe(ul);
    }

    const incidentsHTML = list.length
        ? list.map((p) => incidentItem(p, selectedId)).join('')
        : `<li class="incident-list__empty">No active incidents in California.</li>`;
    const heatHTML = heatList.length
        ? `<li class="incident-list__group" title="Satellite heat from the last 12 hours with no reported fire (CAL FIRE or NIFC) or perimeter within 5 miles">Unconfirmed satellite heat</li>${heatList.map(heatItem).join('')}`
        : '';
    ul.innerHTML = incidentsHTML + heatHTML;

    ul.querySelectorAll('[data-id]').forEach((btn) => btn.addEventListener('click', () => onSelect(btn.dataset.id)));
    ul.querySelectorAll('[data-heat]').forEach((btn) => btn.addEventListener('click', () => onSelectHeat(btn.dataset.heat)));
    updateListFade(ul);
}

export function renderFireWeatherBanner(alert) {
    const el = $('#fw-banner');
    if (!alert) {
        el.hidden = true;
        return;
    }
    const ends = alert.ends ? new Date(alert.ends).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    el.hidden = false;
    el.className = `fw-banner fw-banner--${alert.event === 'Red Flag Warning' ? 'redflag' : 'watch'}`;
    el.innerHTML = `<strong>${e(alert.event)}</strong> in effect for central Orange County${ends ? ` until ${e(ends)}` : ''}.`;
}

export function setStatus(text, tone = 'ok') {
    const el = $('#status');
    el.textContent = text;
    el.dataset.tone = tone;
}

export function markSourceStatus(results) {
    for (const [name, result] of Object.entries(results)) {
        const el = document.querySelector(`[data-source-status="${name}"]`);
        if (!el) continue;
        el.dataset.state = result.status === 'fulfilled' ? 'ok' : result.status;
        el.title = result.status === 'rejected' ? String(result.reason?.message || result.reason) : '';
    }
}
