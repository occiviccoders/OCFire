import '../sass/lab.scss';
import { escapeHTML as e, timeAgo } from './util.js';

// Read-only API served by the research collector (workers/collector).
const API = import.meta.env.VITE_LAB_API || 'https://ocfire-collector.initial-apps.workers.dev';

const STATUS = {
    fire: 'Reported fire',
    not_reported: 'No report',
    recurring: 'Recurring heat',
    active: 'Watching',
    known_fire: 'On known fire',
};
const LEVEL = { high: 'Elevated', moderate: 'Moderate', low: 'Low' };
const RESOLVED = new Set(['fire', 'not_reported', 'recurring']);
const HOUR = 3600 * 1000;

const $ = (sel) => document.querySelector(sel);
const state = { tracks: [], status: null, unmountReplay: null, sort: { key: 'first_seen', dir: -1 } };

const tip = (text) => `<span class="lab-tip" tabindex="0" data-tip="${e(text)}">i</span>`;

const getJSON = async (path) => {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
};

const shortDate = (iso) =>
    iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const pacificDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const isElevated = (t) => t.peak_level === 'moderate' || t.peak_level === 'high';
const reportedAt = (t) => t.incident_started || t.incident_seen;
const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const compass = (deg) => (deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
const num = (v, digits = 0) => (v == null ? '—' : Number(v).toFixed(digits));

// Hours between when the collector knew the signal and when the agency lists the fire as starting.
// Positive = the signal came first.
function leadHours(t, knownAt) {
    const reported = reportedAt(t);
    if (!knownAt || !reported || t.incident_preexisting) return null;
    return (new Date(reported) - new Date(knownAt)) / HOUR;
}

function formatLead(h) {
    if (h == null) return '—';
    const abs = Math.abs(h);
    const span = abs < 48 ? `${abs.toFixed(1)} h` : `${(abs / 24).toFixed(1)} d`;
    return h >= 0 ? `${span} before` : `${span} after`;
}

function levelBadge(level) {
    return level ? `<span class="lab-badge lab-badge--${e(level)}">${LEVEL[level] || e(level)}</span>` : '—';
}

function statusBadge(status) {
    return `<span class="lab-status lab-status--${e(status)}">${STATUS[status] || e(status)}</span>`;
}

const fireMapHref = (t) => `/?at=${t.lat.toFixed(5)},${t.lng.toFixed(5)}&zoom=13&label=${encodeURIComponent(`Track #${t.id}`)}`;

function mapLink(t) {
    return `<a href="${fireMapHref(t)}" title="Open on the fire map" data-stop>${t.lat.toFixed(3)}, ${t.lng.toFixed(3)}</a>`;
}

const satelliteHref = (lat, lng) => `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lng}&zoom=15&basemap=satellite`;

// Agency status for a matched incident: { acres, contained, active, contained_at, out_at }.
function fireStatus(i) {
    if (!i) return '';
    const state = i.out_at ? 'Out' : i.contained >= 100 || i.contained_at ? 'Contained' : i.active === 0 ? 'No longer active' : 'Active';
    const parts = [state];
    if (i.acres != null) parts.push(`${i.acres < 1 ? '<1' : Math.round(i.acres).toLocaleString()} ac`);
    if (i.contained != null && !i.out_at && i.contained < 100) parts.push(`${Math.round(i.contained)}% contained`);
    return parts.join(' · ');
}

const trackFireStatus = (t) =>
    t.incident_id
        ? fireStatus({ acres: t.incident_acres, contained: t.incident_contained, active: t.incident_active, contained_at: t.incident_contained_at, out_at: t.incident_out_at })
        : '';

function renderHealth() {
    const { totals, recentRuns } = state.status;
    const last = recentRuns[0];
    const errors = recentRuns.filter((r) => r.errors);
    const stale = last && Date.now() - new Date(last.started_at) > 45 * 60 * 1000;
    $('#health').innerHTML = `
        <div class="lab-health__row"><span class="lab-dot${stale ? ' lab-dot--stale' : ''}"></span>
            ${last ? `Last run ${timeAgo(last.started_at)}` : 'No runs yet'} · every 15 min</div>
        <div class="lab-health__row">Collecting since ${shortDate(totals.since)} · ${totals.runs} runs</div>
        <div class="lab-health__row">${totals.detections.toLocaleString()} detections · ${totals.snapshots.toLocaleString()} snapshots ·
            ${totals.incidents.toLocaleString()} incidents</div>
        ${errors.length ? `<div class="lab-health__row lab-health__warn" title="${e(errors.map((r) => r.errors).join('\n'))}">
            ${errors.length} of the last ${recentRuns.length} runs had a feed error (hover for details)</div>` : ''}`;
}

function renderScorecard() {
    const fresh = state.tracks.filter((t) => t.status !== 'known_fire');
    const rows = [
        { label: 'Any new hotspot', test: () => true, knownAt: (t) => t.first_collected },
        { label: 'Reached Moderate or Elevated', test: isElevated, knownAt: (t) => t.moderate_known_at },
        { label: 'Reached Elevated', test: (t) => t.peak_level === 'high', knownAt: (t) => t.strong_known_at },
    ].map(({ label, test, knownAt }) => {
        const group = fresh.filter(test);
        const resolved = group.filter((t) => RESOLVED.has(t.status));
        const fires = resolved.filter((t) => t.status === 'fire');
        const leads = fires.map((t) => leadHours(t, knownAt(t))).filter((h) => h != null);
        return `
            <tr>
                <th>${label}</th>
                <td>${group.length}</td>
                <td>${resolved.length}</td>
                <td>${fires.length}</td>
                <td><strong>${pct(fires.length, resolved.length)}</strong></td>
                <td>${formatLead(median(leads))}${leads.length ? ` <span class="lab-dim">(n=${leads.length})</span>` : ''}</td>
            </tr>`;
    });

    const fires = fresh.filter((t) => t.status === 'fire');
    const timed = fires.filter((t) => !t.incident_preexisting && reportedAt(t));
    const early = timed.filter((t) => t.moderate_known_at && new Date(t.moderate_known_at) <= new Date(reportedAt(t)));
    const missed = fires.filter((t) => !isElevated(t));
    const resolvedCount = fresh.filter((t) => RESOLVED.has(t.status)).length;
    const large = fires.filter((t) => t.incident_acres >= 10);
    const largeFlagged = large.filter(isElevated);

    $('#scorecard').innerHTML = `
        <div class="lab-table-wrap">
            <table class="lab-table lab-table--score">
                <thead><tr>
                    <th>Alert level</th>
                    <th>Tracks</th>
                    <th>Resolved ${tip('Settled: matched to a reported fire, or 72 hours with no new heat.')}</th>
                    <th>Reported fire</th>
                    <th>Hit rate ${tip('Of the resolved tracks, the share that turned out to be a reported fire.')}</th>
                    <th>Median lead time ${tip('Typical time between when we had the track at this level and the agency’s listed start time. Positive means we were earlier.')}</th>
                </tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        </div>
        <ul class="lab-facts">
            <li><strong>${early.length} of ${timed.length}</strong> reported fires reached Moderate before the agency's listed start time.</li>
            <li><strong>${missed.length} of ${fires.length}</strong> reported fires never got past Low (misses worth studying).</li>
            <li><strong>${largeFlagged.length} of ${large.length}</strong> reported fires that grew to 10+ acres reached Moderate or Elevated.</li>
            <li class="lab-dim">Lead time compares when our system had the track at that level with the agency's start time.
                Fires already listed before collection began are left out.</li>
            ${resolvedCount < 30 ? '<li class="lab-dim">Still early: these numbers mean more once a few hundred tracks have resolved.</li>' : ''}
        </ul>`;
}

function renderDaily() {
    const days = new Map();
    const today = new Date();
    for (let i = 29; i >= 0; i--) days.set(pacificDay(new Date(today - i * 24 * HOUR)), { low: 0, moderate: 0, high: 0, fire: 0 });
    for (const t of state.tracks) {
        if (t.status === 'known_fire') continue;
        const d = days.get(pacificDay(t.first_seen));
        if (!d) continue;
        d[t.peak_level || 'low']++;
        if (t.status === 'fire') d.fire++;
    }
    const max = Math.max(1, ...[...days.values()].map((d) => d.low + d.moderate + d.high));
    const bars = [...days].map(([day, d]) => {
        const total = d.low + d.moderate + d.high;
        const seg = (k) => (d[k] ? `<span class="lab-bar__seg lab-bar__seg--${k}" style="height:${(100 * d[k]) / max}%"></span>` : '');
        const label = new Date(`${day}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `
            <div class="lab-bar" title="${label}: ${total} new · ${d.moderate} Moderate · ${d.high} Elevated · ${d.fire} reported fire${d.fire === 1 ? '' : 's'}">
                <div class="lab-bar__stack">${seg('high')}${seg('moderate')}${seg('low')}</div>
                ${d.fire ? `<span class="lab-bar__fire">${d.fire}</span>` : ''}
                <span class="lab-bar__label">${label.replace(' ', '\u00a0')}</span>
            </div>`;
    });
    $('#daily').innerHTML = `
        <div class="lab-bars">${bars.join('')}</div>
        <div class="lab-legend">
            <span><i class="lab-bar__seg--high"></i>Elevated</span>
            <span><i class="lab-bar__seg--moderate"></i>Moderate</span>
            <span><i class="lab-bar__seg--low"></i>Low</span>
            <span><b class="lab-bar__fire">n</b>became a reported fire</span>
        </div>`;
}

function filteredTracks() {
    const status = $('#filter-status').value;
    const signal = $('#filter-signal').value;
    return state.tracks.filter((t) => {
        if (status === 'new' && t.status === 'known_fire') return false;
        if (status !== 'new' && status !== 'all' && t.status !== status) return false;
        if (signal === 'moderate' && !isElevated(t)) return false;
        if (signal === 'high' && t.peak_level !== 'high') return false;
        return true;
    });
}

// Missing values sort last in either direction.
const SORT_VALUE = {
    id: (t) => t.id,
    first_seen: (t) => t.first_seen,
    status: (t) => STATUS[t.status] || t.status,
    peak_score: (t) => t.peak_score,
    passes: (t) => t.passes,
    detections: (t) => t.detections,
    max_frp: (t) => t.max_frp,
    moderate_known_at: (t) => t.moderate_known_at,
    incident_name: (t) => t.incident_name || t.known_at_start,
    lead: (t) => leadHours(t, t.moderate_known_at),
};

function sortTracks(list) {
    const { key, dir } = state.sort;
    const value = SORT_VALUE[key];
    return [...list].sort((a, b) => {
        const va = value(a), vb = value(b);
        if (va == null || vb == null) return (va == null) - (vb == null);
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
}

function renderSortHeaders() {
    document.querySelectorAll('#tracks th[data-sort]').forEach((th) => {
        const active = th.dataset.sort === state.sort.key;
        th.classList.toggle('is-sorted', active);
        th.setAttribute('aria-sort', active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
        th.dataset.arrow = active ? (state.sort.dir > 0 ? '▲' : '▼') : '';
    });
}

function renderTracks() {
    renderSortHeaders();
    const list = sortTracks(filteredTracks());
    const shown = list.slice(0, 500);
    $('#tracks tbody').innerHTML = shown.length
        ? shown.map((t) => `
            <tr data-id="${t.id}">
                <td>${t.id}</td>
                <td>${shortDate(t.first_seen)}</td>
                <td>${mapLink(t)}</td>
                <td>${statusBadge(t.status)}${t.incident_id ? `<div class="lab-dim lab-sub">${e(trackFireStatus(t))}</div>` : ''}</td>
                <td>${levelBadge(t.peak_level)}</td>
                <td>${t.passes}</td>
                <td>${t.detections}</td>
                <td>${num(t.max_frp, 1)}</td>
                <td>${shortDate(t.moderate_known_at)}</td>
                <td>${t.incident_name ? e(t.incident_name) : t.known_at_start ? `<span class="lab-dim">${e(t.known_at_start)}</span>` : '—'}</td>
                <td>${formatLead(leadHours(t, t.moderate_known_at))}</td>
            </tr>`).join('')
        : '<tr><td colspan="11" class="lab-empty">No tracks match these filters yet.</td></tr>';
    if (list.length > shown.length) {
        $('#tracks tbody').insertAdjacentHTML('beforeend', `<tr><td colspan="11" class="lab-empty">Showing 500 of ${list.length}. Download the CSV for all.</td></tr>`);
    }
}

function scoreChart(snapshots, track) {
    const W = 800, H = 220, PAD = { l: 34, r: 12, t: 14, b: 26 };
    const times = snapshots.map((s) => new Date(s.pass_time).getTime());
    const reported = reportedAt(track) ? new Date(reportedAt(track)).getTime() : null;
    const t0 = Math.min(...times, reported ?? Infinity);
    const t1 = Math.max(...times, reported ?? -Infinity, t0 + HOUR);
    const scores = snapshots.map((s) => s.score);
    const y0 = Math.min(-2, ...scores), y1 = Math.max(7, ...scores);
    const x = (t) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + ((y1 - v) / (y1 - y0)) * (H - PAD.t - PAD.b);
    const hline = (v, label, cls) =>
        `<line class="${cls}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text class="lab-chart__label" x="${PAD.l + 4}" y="${y(v) - 4}">${label}</text>`;
    const path = snapshots.map((s, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(s.score).toFixed(1)}`).join('');
    const ticks = [t0, (t0 + t1) / 2, t1].map((t, i) =>
        `<text class="lab-chart__tick" x="${x(t)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${shortDate(new Date(t).toISOString())}</text>`);
    return `
        <svg class="lab-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Signal score over time">
            ${hline(5, 'Elevated (5+)', 'lab-chart__strong')}
            ${hline(3, 'Moderate (3+)', 'lab-chart__moderate')}
            ${hline(0, '0', 'lab-chart__zero')}
            ${reported ? `<line class="lab-chart__reported" x1="${x(reported)}" x2="${x(reported)}" y1="${PAD.t}" y2="${H - PAD.b}"/>
                <text class="lab-chart__label lab-chart__label--reported" x="${x(reported) + 4}" y="${PAD.t + 10}">Agency start time</text>` : ''}
            <path class="lab-chart__line" d="${path}"/>
            ${snapshots.map((s, i) => `<circle class="lab-chart__pt lab-chart__pt--${e(s.level)}" cx="${x(times[i])}" cy="${y(s.score)}" r="4"><title>${shortDate(s.pass_time)} · score ${s.score}</title></circle>`).join('')}
            ${ticks.join('')}
        </svg>`;
}

const SATELLITES = { N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', T: 'Terra', A: 'Aqua', Terra: 'Terra', Aqua: 'Aqua' };
const SOURCES = { wfigs: 'NIFC', calfire: 'CAL FIRE' };
const KIND_ORDER = { heat: 0, model: 1, official: 2, collector: 3 };

function formatSpan(ms) {
    const mins = Math.round(Math.abs(ms) / 60000);
    return mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${(mins / 1440).toFixed(1)} days`;
}

// Everything known about one track, in time order: satellite passes, score changes, agency times, and
// when the collector itself saw each piece.
const acresText = (a) => `${a < 1 ? '<1' : Math.round(a).toLocaleString()} ac`;

// Size / containment / status changes the agency published after the fire was reported.
function lifecycleEvents(incident, history) {
    const events = [];
    let prev = null;
    for (const h of history) {
        const changes = [];
        if (!prev) {
            if (h.acres != null) changes.push(`Size listed: ${acresText(h.acres)}`);
            if (h.contained != null) changes.push(`${Math.round(h.contained)}% contained`);
        } else {
            if (h.acres != null && h.acres !== prev.acres) changes.push(`${h.acres > (prev.acres ?? 0) ? 'Grew to' : 'Size revised to'} ${acresText(h.acres)}`);
            if (h.contained != null && h.contained !== prev.contained) changes.push(`${Math.round(h.contained)}% contained`);
            if (h.active === 0 && prev.active === 1) changes.push('No longer listed as active');
        }
        if (changes.length) events.push({ at: h.at, kind: 'official', lifecycle: true, title: changes.join(' · ') });
        prev = h;
    }
    if (incident?.contained_at) events.push({ at: incident.contained_at, kind: 'official', lifecycle: true, title: 'Officially contained' });
    if (incident?.controlled_at) events.push({ at: incident.controlled_at, kind: 'official', lifecycle: true, title: 'Officially controlled' });
    if (incident?.out_at) events.push({ at: incident.out_at, kind: 'official', lifecycle: true, title: 'Declared out' });
    return events;
}

function timelineEvents(t, incident, history, snapshots, detections, summary) {
    const events = [];
    const passes = new Map();
    for (const d of detections) {
        const key = `${d.acquired}|${d.satellite}`;
        const p = passes.get(key) || { at: d.acquired, satellite: d.satellite, instrument: d.instrument, count: 0, frp: 0 };
        p.count++;
        p.frp += d.frp || 0;
        passes.set(key, p);
    }
    const scored = new Set();
    for (const p of passes.values()) {
        const snap = !scored.has(p.at) && snapshots.find((s) => s.pass_time === p.at);
        if (snap) scored.add(p.at);
        events.push({
            at: p.at,
            kind: 'heat',
            title: `Satellite heat: ${SATELLITES[p.satellite] || p.satellite}${p.instrument ? ` (${p.instrument})` : ''}`,
            detail: `${p.count} detection${p.count === 1 ? '' : 's'} · ${p.frp.toFixed(1)} MW`,
            badge: snap ? `${levelBadge(snap.level)} score ${snap.score}` : '',
        });
    }
    if (t.first_moderate_at) events.push({ at: t.first_moderate_at, kind: 'model', title: 'Alert reached Moderate (3+ points)', detail: 'Using satellite data through this pass' });
    if (t.first_strong_at) events.push({ at: t.first_strong_at, kind: 'model', title: 'Alert reached Elevated (5+ points)', detail: 'Using satellite data through this pass' });

    const collected = detections.map((d) => d.collected_at).sort()[0];
    if (collected) {
        events.push({
            at: collected,
            kind: 'collector',
            title: 'We logged this heat',
            detail: 'When our system received the satellite data. NASA usually publishes a pass 1–3 hours after the satellite sees it',
        });
    }
    if (summary.moderate_known_at && summary.moderate_known_at !== collected) {
        events.push({ at: summary.moderate_known_at, kind: 'collector', title: 'We rated it Moderate' });
    }

    if (incident) {
        const where = [incident.name, SOURCES[incident.source] || incident.source, incident.county && `${incident.county} County`].filter(Boolean).join(' · ');
        if (incident.started) events.push({ at: incident.started, kind: 'official', title: 'Official discovery time', detail: where });
        if (incident.reported) events.push({ at: incident.reported, kind: 'official', title: 'Official incident record created', detail: where });
        events.push({
            at: incident.first_seen,
            kind: 'collector',
            title: 'We first saw the incident report',
            detail: incident.preexisting ? 'Already listed when collection began' : '',
        });
        events.push(...lifecycleEvents(incident, history));
    }
    return events.sort((a, b) => a.at.localeCompare(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function timelineHTML(events, t, incident) {
    if (!events.length) return '<p class="lab-dim">No events yet.</p>';
    const start = Date.parse(t.first_seen);
    const leads = [];
    if (incident?.started) leads.push(['official discovery', incident.started]);
    if (incident?.reported) leads.push(['the official record', incident.reported]);
    const headline = leads
        .map(([label, at]) => {
            const ms = Date.parse(at) - start;
            return `${formatSpan(ms)} ${ms >= 0 ? 'before' : 'after'} ${label}`;
        })
        .join(' and ');
    return `
        ${headline ? `<p class="lab-timeline__headline">First satellite heat came <strong>${headline}</strong>.</p>` : ''}
        <ol class="lab-timeline">
            ${events.map((ev) => {
                const offset = Date.parse(ev.at) - start;
                return `
                    <li class="lab-timeline__item lab-timeline__item--${ev.kind}">
                        <div class="lab-timeline__when">
                            <span>${shortDate(ev.at)}</span>
                            <span class="lab-dim">${offset === 0 ? 'start' : `${offset > 0 ? '+' : '−'}${formatSpan(offset)}`}</span>
                        </div>
                        <div class="lab-timeline__what">
                            <div class="lab-timeline__title">${e(ev.title)} ${ev.badge || ''}</div>
                            ${ev.detail ? `<div class="lab-dim">${e(ev.detail)}</div>` : ''}
                        </div>
                    </li>`;
            }).join('')}
        </ol>
        <div class="lab-legend lab-timeline__legend">
            <span><i class="lab-timeline__key--heat"></i>Satellite</span>
            <span><i class="lab-timeline__key--model"></i>Model</span>
            <span><i class="lab-timeline__key--official"></i>Official</span>
            <span><i class="lab-timeline__key--collector"></i>When our system logged it ${tip('Our background job checks NASA and the fire agencies every 15 minutes. These times show when it received each piece, which is usually later than when it happened.')}</span>
        </div>`;
}

function reasonsHTML(snapshot) {
    let reasons = [];
    try {
        reasons = JSON.parse(snapshot?.reasons || '[]');
    } catch {}
    return reasons.length
        ? `<ul class="lab-reasons">${reasons.map((r) => `<li class="lab-reasons__item lab-reasons__item--${e(r.tone)}">${e(r.text)}</li>`).join('')}</ul>`
        : '<p class="lab-dim">No reasons recorded.</p>';
}

async function showDetail(id) {
    const panel = $('#detail');
    panel.hidden = false;
    panel.innerHTML = '<p class="lab-dim">Loading track…</p>';
    document.querySelectorAll('#tracks tr.is-selected').forEach((tr) => tr.classList.remove('is-selected'));
    document.querySelector(`#tracks tr[data-id="${id}"]`)?.classList.add('is-selected');

    let data;
    try {
        data = await getJSON(`/api/tracks/${id}`);
    } catch (err) {
        panel.innerHTML = `<p class="lab-error">Couldn't load track ${id}: ${e(err.message)}</p>`;
        return;
    }
    const { track: t, incident, history = [], snapshots, detections } = data;
    const summary = state.tracks.find((r) => r.id === t.id) || t;
    const latest = snapshots[snapshots.length - 1];
    const events = timelineEvents(t, incident, history, snapshots, detections, summary);
    state.unmountReplay?.();
    state.unmountReplay = null;

    panel.innerHTML = `
        <div class="lab-card__head">
            <h2 class="lab-card__title">Track #${t.id} ${statusBadge(t.status)} ${levelBadge(t.peak_level)}</h2>
            <div class="lab-filters">
                <a class="lab-btn" href="${fireMapHref(t)}">Open on fire map</a>
                <button class="lab-btn" data-close>Close</button>
            </div>
        </div>
        <dl class="lab-dl">
            <div><dt>Location</dt><dd>${t.lat.toFixed(4)}, ${t.lng.toFixed(4)} ·
                <a href="${satelliteHref(t.lat, t.lng)}" target="_blank" rel="noopener">satellite view</a></dd></div>
            ${incident ? `<div><dt>Fire status</dt><dd>${e(fireStatus(incident))}${incident.cause ? ` <span class="lab-dim">· cause: ${e(incident.cause)}</span>` : ''}
                ${incident.url ? ` · <a href="${e(incident.url)}" target="_blank" rel="noopener">official page</a>` : ''}</dd></div>` : ''}
            <div><dt>First pass</dt><dd>${shortDate(t.first_seen)}</dd></div>
            <div><dt>Latest pass</dt><dd>${shortDate(t.last_seen)}</dd></div>
            <div><dt>Detections / passes</dt><dd>${t.detections} / ${t.passes}</dd></div>
            <div><dt>Max FRP ${tip('Fire radiative power: heat output in megawatts. Under 5 MW is small; 20+ MW is a strong, active fire.')}</dt><dd>${num(t.max_frp, 1)} MW</dd></div>
            <div><dt>Moderate: pass / we logged it ${tip('The satellite pass whose data first put it at Moderate, and when our system actually had that data.')}</dt><dd>${shortDate(t.first_moderate_at)} / ${shortDate(summary.moderate_known_at)}</dd></div>
            <div><dt>Elevated: pass / we logged it ${tip('Same as above, for Elevated (5+ points).')}</dt><dd>${shortDate(t.first_strong_at)} / ${shortDate(summary.strong_known_at)}</dd></div>
            <div><dt>Reported as</dt><dd>${t.incident_name ? `${e(t.incident_name)} <span class="lab-dim">(${e(t.incident_source || '')})</span>` : t.known_at_start ? e(t.known_at_start) : '—'}</dd></div>
            <div><dt>Official discovery</dt><dd>${shortDate(incident?.started)}${incident?.preexisting ? ' <span class="lab-dim">(listed before collection began)</span>' : ''}</dd></div>
            <div><dt>Official record created</dt><dd>${shortDate(incident?.reported)}</dd></div>
        </dl>
        <h3 class="lab-h3">Timeline</h3>
        ${detections.length ? '<div class="lab-replay-wrap" data-replay><p class="lab-dim">Loading map…</p></div>' : ''}
        ${timelineHTML(events, t, incident)}
        ${snapshots.length > 1 ? `<h3 class="lab-h3">Alert points by satellite pass ${tip('Each dot is the points total after a pass. 5+ is Elevated, 3–4 Moderate, under 3 Low. See "How scoring works" at the top.')}</h3>${scoreChart(snapshots, t)}` : ''}
        <h3 class="lab-h3">Why, as of the latest pass</h3>
        ${reasonsHTML(latest)}
        <h3 class="lab-h3">Every pass</h3>
        <div class="lab-table-wrap">
            <table class="lab-table">
                <thead><tr>
                    <th>Pass ${tip('When the satellite flew over.')}</th>
                    <th>Logged ${tip('When our system received that pass from NASA.')}</th>
                    <th>Det. ${tip('Detections: hot satellite pixels so far.')}</th>
                    <th>Sats ${tip('How many different satellites have seen it.')}</th>
                    <th>FRP ${tip('Total heat output in megawatts across detections.')}</th>
                    <th>Spread ${tip('Widest distance between any two detections.')}</th>
                    <th>Drift ${tip('How far later detections sit from the first one, and in which direction. Moving with the wind is a fire sign.')}</th>
                    <th>Wind</th><th>Humidity</th>
                    <th>Weather ${tip('Fire weather at the spot: normal, elevated (dry and breezy) or critical (Red Flag-level).')}</th>
                    <th>Red Flag ${tip('Inside a National Weather Service Red Flag Warning.')}</th>
                    <th>Smoke ${tip('Smoke plume over the spot in NOAA satellite smoke maps.')}</th>
                    <th>CHP calls ${tip('Fire-related calls on the CHP incident feed within 3 miles in the last 6 hours.')}</th>
                    <th>Past yr ${tip('Days with satellite heat at this spot in the past year. Many days means a farm, flare or landfill.')}</th>
                    <th>Points ${tip('Alert points after this pass. 5+ Elevated, 3–4 Moderate.')}</th>
                </tr></thead>
                <tbody>${snapshots.map((s) => `
                    <tr>
                        <td>${shortDate(s.pass_time)}</td>
                        <td>${shortDate(s.taken_at)}</td>
                        <td>${s.detections}</td>
                        <td>${s.satellites}</td>
                        <td>${num(s.sum_frp, 1)}</td>
                        <td>${num(s.extent_mi, 2)} mi</td>
                        <td>${s.drift_mi == null ? '—' : `${num(s.drift_mi, 2)} mi ${compass(s.drift_bearing)}`}</td>
                        <td>${s.wind_speed == null ? '—' : `${num(s.wind_speed)} mph ${compass(s.wind_dir)}, gusts ${num(s.wind_gust)}`}</td>
                        <td>${s.humidity == null ? '—' : `${num(s.humidity)}%`}</td>
                        <td>${e(s.weather_level || '—')}</td>
                        <td>${s.red_flag ? 'Yes' : 'No'}</td>
                        <td>${['None', 'Light', 'Medium', 'Heavy'][s.smoke_level] || '—'}</td>
                        <td>${s.chp_fire_reports ?? '—'}</td>
                        <td>${s.past_days ?? '—'} d</td>
                        <td>${levelBadge(s.level)} ${s.score}</td>
                    </tr>`).join('')}</tbody>
            </table>
        </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const replay = panel.querySelector('[data-replay]');
    if (replay) {
        const { mountReplay } = await import('./labReplay.js');
        if (panel.contains(replay)) state.unmountReplay = mountReplay(replay, { track: t, incident, snapshots, detections, events });
    }
}

function downloadCSV() {
    const rows = filteredTracks();
    if (!rows.length) return;
    const columns = [...Object.keys(rows[0]), 'lead_hours_moderate'];
    const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [columns.join(','), ...rows.map((t) => columns.map((c) => cell(c === 'lead_hours_moderate' ? leadHours(t, t.moderate_known_at)?.toFixed(2) : t[c])).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `fire-watch-tracks-${pacificDay(new Date())}.csv` });
    a.click();
    URL.revokeObjectURL(url);
}

// `?near=lat,lng` (linked from heat popups on the fire map): the most recent track within ~2 miles.
function nearestTrackId(near) {
    const [lat, lng] = (near || '').split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const close = state.tracks.filter((t) => Math.abs(t.lat - lat) < 0.03 && Math.abs(t.lng - lng) < 0.035);
    return close.sort((a, b) => b.last_seen.localeCompare(a.last_seen))[0]?.id ?? null;
}

// One floating box for every [data-tip], positioned on screen so table scroll areas can't clip it.
function wireTooltips() {
    const box = document.createElement('div');
    box.className = 'lab-tooltip';
    box.hidden = true;
    document.body.append(box);
    let current = null;
    const show = (el) => {
        current = el;
        box.textContent = el.dataset.tip;
        box.hidden = false;
        const r = el.getBoundingClientRect();
        const w = box.offsetWidth;
        box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
        const below = r.bottom + 8 + box.offsetHeight < window.innerHeight;
        box.style.top = `${below ? r.bottom + 8 : r.top - box.offsetHeight - 8}px`;
    };
    const hide = () => {
        current = null;
        box.hidden = true;
    };
    document.addEventListener('mouseover', (ev) => {
        const el = ev.target.closest('[data-tip]');
        if (el && el !== current) show(el);
        else if (!el && current) hide();
    });
    document.addEventListener('focusin', (ev) => {
        const el = ev.target.closest('[data-tip]');
        if (el) show(el);
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('click', (ev) => {
        const el = ev.target.closest('[data-tip]');
        if (el) {
            ev.stopPropagation();
            if (el === current) hide();
            else show(el);
        } else if (current) hide();
    }, true);
    window.addEventListener('scroll', hide, { passive: true, capture: true });
}

async function init() {
    try {
        [state.status, state.tracks] = await Promise.all([getJSON('/api/status'), getJSON('/api/tracks')]);
    } catch (err) {
        $('#health').innerHTML = `<span class="lab-error">Couldn't reach the collector (${e(err.message)}).</span>`;
        return;
    }
    renderHealth();
    renderScorecard();
    renderDaily();
    renderTracks();

    $('#filter-status').addEventListener('change', renderTracks);
    $('#filter-signal').addEventListener('change', renderTracks);
    $('#download').addEventListener('click', downloadCSV);
    $('#tracks thead').addEventListener('click', (ev) => {
        if (ev.target.closest('.lab-tip')) return;
        const th = ev.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        // Text columns start A→Z; numbers and dates start biggest/newest first.
        const ascFirst = key === 'status' || key === 'incident_name';
        state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: ascFirst ? 1 : -1 };
        renderTracks();
    });
    wireTooltips();
    $('#tracks tbody').addEventListener('click', (ev) => {
        if (ev.target.closest('[data-stop]')) return;
        const row = ev.target.closest('tr[data-id]');
        if (row) showDetail(Number(row.dataset.id));
    });
    $('#detail').addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-close]')) return;
        state.unmountReplay?.();
        state.unmountReplay = null;
        $('#detail').hidden = true;
        document.querySelectorAll('#tracks tr.is-selected').forEach((tr) => tr.classList.remove('is-selected'));
    });

    const params = new URLSearchParams(location.search);
    const id = Number(params.get('track')) || nearestTrackId(params.get('near'));
    if (id) showDetail(id);
}

init();
