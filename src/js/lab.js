import '../sass/lab.scss';
import { nearestCity } from './caCities.js';
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
const HOUR = 3600 * 1000;

const $ = (sel) => document.querySelector(sel);
const state = { tracks: [], status: null, unmountReplay: null, sort: { key: 'sat', dir: -1 } };

const tip = (text) => `<span class="lab-tip" tabindex="0" data-tip="${e(text)}">i</span>`;

const getJSON = async (path) => {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
};

const shortDate = (iso) =>
    iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const pacificDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const reportedAt = (t) => t.incident_started || t.incident_seen;
const compass = (deg) => (deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
const num = (v, digits = 0) => (v == null ? '—' : Number(v).toFixed(digits));

// Hours between when the collector knew the signal and when the agency lists the fire as starting.
// Positive = the signal came first.
function leadHours(t, knownAt) {
    const reported = reportedAt(t);
    if (!knownAt || !reported || t.incident_preexisting) return null;
    return (new Date(reported) - new Date(knownAt)) / HOUR;
}

function levelBadge(level, score) {
    if (!level) return '—';
    const name = LEVEL[level] || level;
    const text = score == null || score === '' ? name : `${name} ${score}`;
    return `<span class="lab-badge lab-badge--${e(level)}">${e(text)}</span>`;
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

const NAMED_FIRE = /\b(fire|complex)$/i;
const QUIET_MS = 72 * HOUR;

// WFIGS often stores just "BRYSON". CAL FIRE stores "Henderson Fire". Same fire either way.
function bareName(name) {
    return name.trim().replace(/\s+(fire|complex)$/i, '');
}

function fireTitle(names) {
    const titled = names.find((n) => NAMED_FIRE.test(n));
    if (titled) return titled.trim();
    const words = bareName(names[0]).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return `${words} Fire`;
}

function isPredicted(t) {
    return t.peak_level === 'high' || (t.peak_score ?? 0) >= 5;
}

// One row per named fire (clusters merged) or per unnamed cluster.
function observations() {
    const named = new Map();
    const loose = [];
    for (const t of state.tracks) {
        const name = (t.incident_name || '').trim();
        if (name && (NAMED_FIRE.test(name) || t.status === 'fire')) {
            const key = bareName(name).toUpperCase();
            const g = named.get(key) || [];
            g.push(t);
            named.set(key, g);
        } else if (t.status !== 'known_fire') {
            loose.push([t]);
        }
    }
    return [...named.values(), ...loose].map((tracks) => {
        const peak = tracks.reduce((a, t) => ((t.peak_score ?? -99) > (a.peak_score ?? -99) ? t : a));
        const sat = Math.min(...tracks.map((t) => Date.parse(t.first_seen)));
        const logged = Math.min(...tracks.map((t) => Date.parse(t.first_collected || t.first_seen)));
        const names = [...new Set(tracks.map((t) => (t.incident_name || '').trim()).filter(Boolean))];
        const namedRow = names.length > 0 && names.some((n) => NAMED_FIRE.test(n) || tracks.some((t) => t.status === 'fire'));
        const identified = namedRow
            ? (tracks.map((t) => Date.parse(t.incident_started)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null)
            : null;
        const last = Math.max(...tracks.map((t) => Date.parse(t.last_seen || t.first_seen)));
        const quiet = !namedRow && (tracks.every((t) => t.status === 'not_reported' || t.status === 'recurring') || Date.now() - last >= QUIET_MS);
        const lat = tracks.reduce((s, t) => s + t.lat, 0) / tracks.length;
        const lng = tracks.reduce((s, t) => s + t.lng, 0) / tracks.length;
        return {
            id: peak.id,
            name: namedRow ? fireTitle(names) : `Cluster #${peak.id}`,
            near: namedRow ? null : nearestCity(lat, lng),
            named: namedRow,
            acres: tracks.find((t) => t.incident_acres != null)?.incident_acres ?? null,
            clusters: tracks.length,
            peakScore: peak.peak_score,
            peakLevel: peak.peak_level,
            predicted: tracks.some(isPredicted),
            sat, logged, identified, last, quiet,
            open: !namedRow && !quiet,
            lat,
            lng,
            satLead: identified ? (identified - sat) / 60000 : null,
            ourLead: identified ? (identified - logged) / 60000 : null,
        };
    });
}

function spanMin(min) {
    const abs = Math.abs(min);
    if (abs < 90) return `${Math.round(abs)} min`;
    if (abs < 36 * 60) return `${(abs / 60).toFixed(1)} h`;
    return `${(abs / 1440).toFixed(1)} d`;
}

function rangePhrase(mins) {
    if (!mins.length) return '';
    const a = Math.min(...mins);
    const b = Math.max(...mins);
    if (a < 90 && b < 90) return Math.round(a) === Math.round(b) ? `by ${Math.round(a)} min` : `by ${Math.round(a)}–${Math.round(b)} min`;
    return Math.round(a) === Math.round(b) ? `by ${spanMin(a)}` : `by ${spanMin(a)}–${spanMin(b)}`;
}

function leadPill(min) {
    if (min == null || !Number.isFinite(min)) return '—';
    if (min > 1) return `<span class="lab-lead lab-lead--sooner">+${spanMin(min)} sooner</span>`;
    if (min < -1) return `<span class="lab-lead lab-lead--later">${spanMin(min)} later</span>`;
    return '<span class="lab-lead">same time</span>';
}

function renderSummary() {
    const rows = observations();
    const predicted = rows.filter((r) => r.predicted);
    const became = predicted.filter((r) => r.named).length;
    const away = predicted.filter((r) => !r.named && r.quiet).length;
    const still = predicted.filter((r) => !r.named && !r.quiet).length;
    $('#predict').innerHTML = `
        <div class="lab-stats">
            <div class="lab-stat"><b>${became}</b><span>Became a named fire</span></div>
            <div class="lab-stat"><b>${still}</b><span>Still burning · no name yet</span></div>
            <div class="lab-stat"><b>${away}</b><span>Went away on its own</span></div>
        </div>
        <p class="lab-dim">Still early. Heat that’s still burning may get a name later, or fade.</p>`;

    const named = rows.filter((r) => r.named && r.identified);
    const satSoon = named.filter((r) => r.satLead > 1);
    const usSoon = named.filter((r) => r.ourLead > 1);
    const nameFirst = named.filter((r) => r.satLead <= 1);
    const stat = (n, d, label, meaning, range) => `
        <div class="lab-stat"><b>${n} / ${d || 0}</b><span>${label}</span><em>${meaning}${range ? ` · ${range}` : ''}</em></div>`;
    $('#timing').innerHTML = `
        <div class="lab-stats">
            ${stat(satSoon.length, named.length, 'Satellite sooner', 'if the data arrived immediately', rangePhrase(satSoon.map((r) => r.satLead)))}
            ${stat(usSoon.length, named.length, 'Fire Watch sooner', 'caught it even with the delay', rangePhrase(usSoon.map((r) => r.ourLead)))}
            ${stat(nameFirst.length, named.length, 'Named elsewhere', 'we didn’t have the heat yet')}
        </div>`;
}

function filteredRows() {
    const mode = $('#filter-status')?.value || 'current';
    return observations().filter((r) => {
        if (mode === 'predicted') return r.predicted;
        if (mode === 'named') return r.named;
        if (mode === 'open') return r.open;
        return r.named || r.open;
    });
}

// Missing values sort last in either direction.
const SORT_VALUE = {
    name: (r) => r.name,
    peak: (r) => r.peakScore,
    sat: (r) => r.sat,
    logged: (r) => r.logged,
    identified: (r) => r.identified,
    satLead: (r) => r.satLead,
    ourLead: (r) => r.ourLead,
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
    const list = sortTracks(filteredRows());
    const shown = list.slice(0, 500);
    const sub = (r) => {
        const place = r.near ? `near ${r.near}` : '';
        const bits = [r.named ? 'Named fire' : [r.open ? 'No name yet' : 'Went quiet', place].filter(Boolean).join(' · ')];
        if (r.named && r.acres != null) bits.push(`${r.acres < 1 ? '<1' : Math.round(r.acres).toLocaleString()} ac`);
        if (r.clusters > 1) bits.push(`${r.clusters} clusters`);
        return bits.join(' · ');
    };
    const href = (r) => `/?at=${r.lat.toFixed(4)},${r.lng.toFixed(4)}&zoom=11&label=${encodeURIComponent(r.name)}`;
    $('#tracks tbody').innerHTML = shown.length
        ? shown.map((r) => `
            <tr data-id="${r.id}">
                <td><a href="${href(r)}" data-stop>${e(r.name)}</a><div class="lab-dim lab-sub">${e(sub(r))}</div></td>
                <td>${levelBadge(r.peakLevel, r.peakScore)}</td>
                <td>${shortDate(new Date(r.sat).toISOString())}</td>
                <td>${shortDate(new Date(r.logged).toISOString())}</td>
                <td>${r.identified ? shortDate(new Date(r.identified).toISOString()) : '—'}</td>
                <td>${leadPill(r.satLead)}</td>
                <td>${leadPill(r.ourLead)}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="lab-empty">Nothing in this list yet.</td></tr>';
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
            ${snapshots.length <= 30 ? snapshots.map((s, i) => `<text class="lab-chart__score" x="${x(times[i])}" y="${y(s.score) - 9}" text-anchor="middle">${s.score}</text>`).join('') : ''}
            ${snapshots.map((s, i) => `<circle class="lab-chart__pt lab-chart__pt--${e(s.level)}" cx="${x(times[i])}" cy="${y(s.score)}" r="5"><title>${shortDate(s.pass_time)} · ${s.score} points (click for reasons)</title></circle>`).join('')}
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

// Snapshots saved before reasons carried their points: recover them from the wording assess() uses.
const REASON_POINTS = [
    [/industrial heat source/, -2],
    [/^No satellite heat within/, 2],
    [/^Rarely hot here/, 1],
    [/^Sometimes hot here/, 0],
    [/^Hot on \d+ days in the past year/, -2],
    [/^Hot on \d+ of the previous 5 days/, -2],
    [/^\d+ detections$/, 1],
    [/^Only one detection/, 0],
    [/^Seen by \d+ satellites/, 1],
    [/^Seen by only one/, 0],
    [/^High-confidence/, 1],
    [/^Strong heat output/, 1],
    [/^Seen at night/, 1],
    [/^In wildland/, 1],
    [/burning is common|can show up as heat|^Over water/, -1],
    [/^In a developed area/, 0],
    [/^Thunderstorms/, 2],
    [/of rain here in the past 3 days/, -1],
    [/^No rain here/, 0],
    [/^Inside a Red Flag/, 1],
    [/^Red-flag-level weather|^Elevated fire weather/, 1],
    [/^No fire-weather concern/, 0],
    [/in line with the wind/, 2],
];
const reasonPoints = (r) => r.points ?? REASON_POINTS.find(([re]) => re.test(r.text))?.[1] ?? null;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function reasonsHTML(snapshot) {
    let reasons = [];
    try {
        reasons = JSON.parse(snapshot?.reasons || '[]');
    } catch {}
    if (!reasons.length) return '<p class="lab-dim">No reasons recorded.</p>';
    const items = reasons
        .map((r) => ({ ...r, pts: reasonPoints(r) }))
        .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    return `
        <ul class="lab-reasons">${items.map((r) => `
            <li class="lab-reasons__item lab-reasons__item--${e(r.tone)}">
                <span class="lab-pts lab-pts--${r.pts > 0 ? 'up' : r.pts < 0 ? 'down' : 'zero'}">${r.pts == null ? '?' : signed(r.pts)}</span>
                <span>${e(r.text)}</span>
            </li>`).join('')}
        </ul>
        <p class="lab-reasons__total">Total: <strong>${snapshot.score} point${Math.abs(snapshot.score) === 1 ? '' : 's'}</strong> → ${levelBadge(snapshot.level)}
            <span class="lab-dim">(5+ Elevated · 3–4 Moderate · under 3 Low)</span></p>`;
}

// "Why" panel with a slider across every pass, so you can watch the points change.
function whyHTML(snapshots) {
    if (!snapshots.length) return '<p class="lab-dim">No passes scored yet.</p>';
    const last = snapshots.length - 1;
    return `
        ${snapshots.length > 1 ? `
            <div class="lab-why__scrub">
                <input type="range" min="0" max="${last}" value="${last}" step="1" data-why-slider aria-label="Satellite pass">
                <span class="lab-why__label" data-why-label></span>
            </div>` : ''}
        <div data-why-body>${reasonsHTML(snapshots[last])}</div>`;
}

function wireWhy(panel, snapshots) {
    const slider = panel.querySelector('[data-why-slider]');
    const label = panel.querySelector('[data-why-label]');
    const body = panel.querySelector('[data-why-body]');
    const select = (i) => {
        const s = snapshots[i];
        body.innerHTML = reasonsHTML(s);
        if (slider) slider.value = String(i);
        if (label) {
            const prev = snapshots[i - 1];
            const change = prev ? s.score - prev.score : null;
            label.innerHTML = `Pass ${i + 1} of ${snapshots.length} · ${shortDate(s.pass_time)} · ${s.score} pts${change ? ` <span class="lab-dim">(${signed(change)} from previous)</span>` : ''}`;
        }
        panel.querySelectorAll('.lab-chart__pt').forEach((c, j) => c.classList.toggle('is-current', j === i));
    };
    slider?.addEventListener('input', () => select(Number(slider.value)));
    panel.querySelectorAll('.lab-chart__pt').forEach((c, j) => c.addEventListener('click', () => select(j)));
    select(snapshots.length - 1);
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
        <h3 class="lab-h3">Why: points by reason ${tip('Each reason adds or removes points. Drag the slider (or click a dot on the chart) to see the reasons after any pass.')}</h3>
        ${whyHTML(snapshots)}
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
                        <td>${levelBadge(s.level, s.score)}</td>
                    </tr>`).join('')}</tbody>
            </table>
        </div>`;
    wireWhy(panel, snapshots);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const replay = panel.querySelector('[data-replay]');
    if (replay) {
        const { mountReplay } = await import('./labReplay.js');
        if (panel.contains(replay)) state.unmountReplay = mountReplay(replay, { track: t, incident, snapshots, detections, events });
    }
}

function downloadCSV() {
    const rows = filteredRows();
    if (!rows.length) return;
    const columns = ['name', 'named', 'peakLevel', 'peakScore', 'sat', 'logged', 'identified', 'satLead', 'ourLead', 'lat', 'lng'];
    const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(typeof r[c] === 'number' && c.endsWith('Lead') ? r[c].toFixed(1) : r[c])).join(','))];
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
    renderSummary();
    renderTracks();

    $('#filter-status').addEventListener('change', renderTracks);
    $('#download').addEventListener('click', downloadCSV);
    $('#tracks thead').addEventListener('click', (ev) => {
        if (ev.target.closest('.lab-tip')) return;
        const th = ev.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        // Text columns start A→Z; numbers and dates start biggest/newest first.
        const ascFirst = key === 'name';
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
