// California Fire Watch research collector (Cloudflare Worker, runs every 15 minutes).
//
// 1. Stores every NASA FIRMS fire detection in California.
// 2. Groups detections into tracks that persist across satellite passes.
// 3. After each new pass, saves a snapshot of what was known then: detections, spread, weather,
//    Red Flag status, smoke, CHP fire calls, history, and the same fire-signal score the map shows.
// 4. Labels each track by matching it to CAL FIRE and national (WFIGS) incidents, or marks it
//    not reported once it goes quiet.
//
// Data comes through the site's own proxies (SITE), so no API keys live here.

import { assess, CLUSTER_MI, daysSeenBefore, INCIDENT_MI, PERSISTENT_DAYS, RULES_VERSION } from '../../../src/js/earlyDetection.js';
import { historyAt } from '../../../src/js/sources/baseline.js';
import { fireWeatherLevel } from '../../../src/js/wind/fireWeather.js';
import { pointInGeometry } from '../../../src/js/geo.js';
import { distanceMiles } from '../../../src/js/util.js';
import { CA_BBOX } from '../../../src/js/config.js';

const UA = 'California Fire Watch research collector (info@initialapps.com)';
const SENSORS = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT'];
const HISTORY_SENSORS = ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT'];
const BBOX = CA_BBOX.join(',');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ACTIVE_MS = 48 * HOUR; // a track keeps absorbing new detections this long after its last pass
const QUIET_MS = 72 * HOUR; // no new passes and no incident for this long = not reported
const LABEL_LOOKBACK_MS = 14 * DAY; // late-appearing incidents can still relabel a track this old
const MATCH_MI = 3;
const MATCH_BEFORE_MS = 24 * HOUR; // incident start may precede first detection by this much
const MATCH_AFTER_MS = 72 * HOUR;
const CHP_MI = 3;
const RECURRING_PAST_DAYS = 15;
const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

const iso = (ms) => new Date(ms).toISOString();
const utcDay = (ms) => iso(ms).slice(0, 10);
const LEVEL_RANK = { low: 0, moderate: 1, high: 2 };

async function get(url, headers = {}) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`${new URL(url).pathname} ${res.status}`);
    return res;
}

// ---------- Sources ----------

function normalizeConfidence(raw) {
    if (raw === 'h' || raw === 'high') return 'high';
    if (raw === 'l' || raw === 'low') return 'low';
    const n = Number(raw);
    if (Number.isNaN(n)) return 'nominal';
    return n >= 80 ? 'high' : n < 30 ? 'low' : 'nominal';
}

function parseFirms(text) {
    const [head, ...lines] = text.trim().split('\n');
    if (!head?.startsWith('latitude')) throw new Error(`FIRMS: ${head?.slice(0, 80) || 'empty'}`);
    const cols = head.split(',');
    return lines.map((line) => {
        const v = Object.fromEntries(line.split(',').map((x, i) => [cols[i], x]));
        const t = v.acq_time.padStart(4, '0');
        return {
            lat: Number(v.latitude),
            lng: Number(v.longitude),
            acquired: `${v.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00.000Z`,
            satellite: v.satellite,
            instrument: v.instrument,
            confidence: normalizeConfidence(v.confidence),
            frp: Number(v.frp) || 0,
            bright: Number(v.bright_ti4 || v.brightness) || null,
            daynight: v.daynight,
            day: v.acq_date,
        };
    });
}

// FIRMS day ranges are UTC calendar days; ask for two and keep the last 24 hours.
async function fetchHotspots(site, now) {
    const results = await Promise.allSettled(SENSORS.map(async (s) => parseFirms(await (await get(`${site}/api/firms/${s}/${BBOX}/2`)).text())));
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw results[0].reason;
    return ok.flatMap((r) => r.value).filter((d) => d.confidence !== 'low' && Date.parse(d.acquired) >= now - DAY);
}

async function fetchHistory(site, now) {
    const start = utcDay(now - 5 * DAY);
    const results = await Promise.allSettled(HISTORY_SENSORS.map(async (s) => parseFirms(await (await get(`${site}/api/firms/${s}/${BBOX}/5/${start}`)).text())));
    return results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value).map((d) => ({ coords: [d.lng, d.lat], day: d.day }));
}

let baselineCache = null;
async function fetchBaseline(site) {
    if (baselineCache && Date.now() - baselineCache.at < DAY) return baselineCache.data;
    const { from, cell, cells } = await (await get(`${site}/hotspot-baseline.json`)).json();
    const index = new Map();
    for (let i = 0; i < cells.length; i += 5) index.set(`${cells[i]},${cells[i + 1]}`, { days: cells[i + 2], months: cells[i + 3], static: cells[i + 4] === 1 });
    baselineCache = { at: Date.now(), data: { from, cell, index } };
    return baselineCache.data;
}

const zoneCache = new Map();
async function fetchRedFlags(site) {
    const data = await (await get(`${site}/api/nws/alerts/active?area=CA&event=Red%20Flag%20Warning`, { Accept: 'application/geo+json' })).json();
    const geometries = [];
    const zones = new Set();
    for (const alert of data.features) {
        if (alert.geometry) geometries.push(alert.geometry);
        else for (const z of alert.properties.affectedZones || []) zones.add(z);
    }
    await Promise.allSettled([...zones].slice(0, 80).map(async (zoneUrl) => {
        if (!zoneCache.has(zoneUrl)) {
            const zone = await (await get(zoneUrl.replace('https://api.weather.gov/', `${site}/api/nws/`), { Accept: 'application/geo+json' })).json();
            zoneCache.set(zoneUrl, zone.geometry);
        }
        if (zoneCache.get(zoneUrl)) geometries.push(zoneCache.get(zoneUrl));
    }));
    return geometries;
}

const SMOKE_LEVEL = { Light: 1, Medium: 2, Heavy: 3 };
async function fetchSmoke(site, now) {
    for (const offset of [0, 1]) {
        const d = new Date(now - offset * DAY);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const res = await fetch(`${site}/api/hms/${y}/${m}/hms_smoke${y}${m}${dd}.kml`, { headers: { 'User-Agent': UA } });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.includes('<kml')) continue;
        const plumes = [];
        for (const folder of text.split('<Folder>').slice(1)) {
            const level = SMOKE_LEVEL[folder.match(/<name>[^<]*Smoke \((\w+)\)/)?.[1]];
            if (!level) continue;
            for (const [, coords] of folder.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
                const ring = coords.trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number));
                const [w, s, e, n] = CA_BBOX;
                if (ring.length >= 4 && ring.some(([x, yy]) => x > w - 3 && x < e + 3 && yy > s - 3 && yy < n + 3)) {
                    plumes.push({ level, geometry: { type: 'Polygon', coordinates: [ring] } });
                }
            }
        }
        return plumes;
    }
    return [];
}

async function fetchChpFires(site) {
    const xml = await (await get(`${site}/api/chp`)).text();
    const tag = (body, name) => (body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || '').replace(/^"|"$/g, '').trim();
    const fires = [];
    for (const [, body] of xml.matchAll(/<Log\b[^>]*>([\s\S]*?)<\/Log>/g)) {
        if (!/FIRE/i.test(tag(body, 'LogType'))) continue;
        const [lat, lon] = tag(body, 'LATLON').split(':').map(Number);
        if (lat && lon) fires.push([-lon / 1e6, lat / 1e6]);
    }
    return fires;
}

async function fetchCalfire(site, now) {
    const data = await (await get(`${site}/api/calfire/umbraco/api/IncidentApi/GeoJsonList?inactive=true`)).json();
    return data.features
        .filter((f) => f.geometry && f.properties.Started && Date.parse(f.properties.Started) >= now - 30 * DAY)
        .map((f) => {
            const p = f.properties;
            return {
                id: `calfire:${p.UniqueId}`,
                source: 'calfire',
                name: (p.Name || '').trim(),
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                county: p.County,
                started: new Date(p.Started).toISOString(),
                acres: p.AcresBurned ?? null,
                updated: p.Updated ? new Date(p.Updated).toISOString() : null,
            };
        });
}

async function fetchWfigs(now) {
    const since = iso(now - 30 * DAY).slice(0, 19).replace('T', ' ');
    const params = new URLSearchParams({
        where: `POOState='US-CA' AND IncidentTypeCategory='WF' AND FireDiscoveryDateTime >= TIMESTAMP '${since}'`,
        outFields: 'IrwinID,IncidentName,FireDiscoveryDateTime,IncidentSize,POOCounty,ModifiedOnDateTime_dt',
        f: 'geojson',
        resultRecordCount: '2000',
    });
    const data = await (await get(`${WFIGS}?${params}`)).json();
    if (data.error) throw new Error(`WFIGS: ${data.error.message}`);
    return (data.features || [])
        .filter((f) => f.geometry && f.properties.FireDiscoveryDateTime)
        .map((f) => {
            const p = f.properties;
            return {
                id: `wfigs:${p.IrwinID}`,
                source: 'wfigs',
                name: (p.IncidentName || '').trim(),
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                county: p.POOCounty,
                started: iso(p.FireDiscoveryDateTime),
                acres: p.IncidentSize ?? null,
                updated: p.ModifiedOnDateTime_dt ? iso(p.ModifiedOnDateTime_dt) : null,
            };
        });
}

async function fetchWeather(points) {
    const out = [];
    for (let i = 0; i < points.length; i += 50) {
        const chunk = points.slice(i, i + 50);
        const params = new URLSearchParams({
            latitude: chunk.map((p) => p[1].toFixed(3)).join(','),
            longitude: chunk.map((p) => p[0].toFixed(3)).join(','),
            current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
            wind_speed_unit: 'mph',
            temperature_unit: 'fahrenheit',
        });
        const data = await (await get(`https://api.open-meteo.com/v1/forecast?${params}`)).json();
        for (const loc of Array.isArray(data) ? data : [data]) {
            const c = loc.current;
            const w = { speed: c.wind_speed_10m, gust: c.wind_gusts_10m, dir: c.wind_direction_10m, rh: c.relative_humidity_2m, temp: c.temperature_2m };
            out.push({ ...w, level: fireWeatherLevel(w) });
        }
    }
    return out;
}

// ---------- Storage ----------

async function batch(db, statements, size = 50) {
    const results = [];
    for (let i = 0; i < statements.length; i += size) results.push(...(await db.batch(statements.slice(i, i + size))));
    return results;
}

async function upsertIncidents(db, incidents, nowIso, firstRunAt) {
    const sql = db.prepare(`
        INSERT INTO incidents (id, source, name, lat, lng, county, started, first_seen, preexisting, acres, updated)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng,
            started = excluded.started, acres = excluded.acres, updated = excluded.updated`);
    await batch(db, incidents.map((i) => sql.bind(i.id, i.source, i.name, i.lat, i.lng, i.county, i.started, nowIso, i.started < firstRunAt ? 1 : 0, i.acres, i.updated)));
}

async function insertDetections(db, detections, nowIso) {
    const sql = db.prepare(`
        INSERT OR IGNORE INTO detections (lat, lng, acquired, satellite, instrument, confidence, frp, bright_ti4, daynight, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`);
    const results = await batch(db, detections.map((d) => sql.bind(d.lat, d.lng, d.acquired, d.satellite, d.instrument, d.confidence, d.frp, d.bright, d.daynight, nowIso)));
    return detections.map((d, i) => ({ ...d, id: results[i].results[0]?.id })).filter((d) => d.id);
}

// Attach new detections to the nearest active track (any member within CLUSTER_MI), or start a new one.
async function assignTracks(db, fresh, incidents, now, nowIso) {
    const cutoff = iso(now - ACTIVE_MS);
    const { results: rows } = await db.prepare(`
        SELECT d.track_id, d.lat, d.lng FROM detections d JOIN tracks t ON t.id = d.track_id
        WHERE t.last_seen >= ?1 AND d.acquired >= ?1`).bind(cutoff).all();
    const members = new Map();
    for (const r of rows) {
        if (!members.has(r.track_id)) members.set(r.track_id, []);
        members.get(r.track_id).push([r.lng, r.lat]);
    }

    const touched = new Set();
    let created = 0;
    const links = [];
    for (const d of [...fresh].sort((a, b) => a.acquired.localeCompare(b.acquired))) {
        const p = [d.lng, d.lat];
        let best = null;
        let bestMi = CLUSTER_MI;
        for (const [id, pts] of members) {
            for (const q of pts) {
                const mi = distanceMiles(p, q);
                if (mi < bestMi) [best, bestMi] = [id, mi];
            }
        }
        if (best == null) {
            const known = incidents.find((i) => i.started <= d.acquired && distanceMiles(p, [i.lng, i.lat]) < INCIDENT_MI);
            const row = await db.prepare(`
                INSERT INTO tracks (first_seen, last_seen, first_collected, lat, lng, status, known_at_start)
                VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
                .bind(d.acquired, nowIso, d.lat, d.lng, known ? 'known_fire' : 'active', known?.name || null).first();
            best = row.id;
            members.set(best, []);
            created++;
        }
        members.get(best).push(p);
        touched.add(best);
        links.push(db.prepare('UPDATE detections SET track_id = ? WHERE id = ?').bind(best, d.id));
    }
    await batch(db, links);
    return { touched: [...touched], created };
}

function bearing([lng1, lat1], [lng2, lat2]) {
    const r = Math.PI / 180;
    const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
    return ((Math.atan2(y, x) / r) + 360) % 360;
}

async function snapshotTracks(db, trackIds, ctx, nowIso) {
    if (!trackIds.length) return 0;
    const marks = trackIds.map(() => '?').join(',');
    const { results: tracks } = await db.prepare(`SELECT * FROM tracks WHERE id IN (${marks})`).bind(...trackIds).all();
    const { results: dets } = await db.prepare(`SELECT track_id, lat, lng, acquired, satellite, confidence, frp FROM detections WHERE track_id IN (${marks})`).bind(...trackIds).all();
    const byTrack = new Map(tracks.map((t) => [t.id, []]));
    for (const d of dets) byTrack.get(d.track_id)?.push(d);

    const centroids = tracks.map((t) => {
        const ds = byTrack.get(t.id);
        return [ds.reduce((a, d) => a + d.lng, 0) / ds.length, ds.reduce((a, d) => a + d.lat, 0) / ds.length];
    });
    let weather = [];
    try {
        weather = await fetchWeather(centroids);
    } catch (err) {
        ctx.errors.push(`weather: ${err.message}`);
    }

    const statements = [];
    tracks.forEach((t, i) => {
        const ds = byTrack.get(t.id).sort((a, b) => a.acquired.localeCompare(b.acquired));
        const center = centroids[i];
        const cluster = ds.map((d) => ({ geometry: { coordinates: [d.lng, d.lat] }, properties: { acquired: d.acquired } }));
        const info = {
            count: ds.length,
            satellites: new Set(ds.map((d) => d.satellite)).size,
            high: ds.filter((d) => d.confidence === 'high').length,
            maxFrp: Math.max(...ds.map((d) => d.frp || 0)),
        };
        const sumFrp = ds.reduce((a, d) => a + (d.frp || 0), 0);
        let extent = 0;
        for (let a = 0; a < Math.min(ds.length, 300); a++) {
            for (let b = a + 1; b < Math.min(ds.length, 300); b++) extent = Math.max(extent, distanceMiles([ds[a].lng, ds[a].lat], [ds[b].lng, ds[b].lat]));
        }
        const firstMs = Date.parse(ds[0].acquired);
        const later = ds.filter((d) => Date.parse(d.acquired) - firstMs > 30 * 60000);
        let drift = null;
        let driftBearing = null;
        if (later.length) {
            const start = [ds[0].lng, ds[0].lat];
            const end = [later.reduce((a, d) => a + d.lng, 0) / later.length, later.reduce((a, d) => a + d.lat, 0) / later.length];
            drift = distanceMiles(start, end);
            driftBearing = bearing(start, end);
        }

        const past = historyAt(ctx.baseline, center);
        const firstDay = t.first_seen.slice(0, 10);
        const priorDays = daysSeenBefore(center, ctx.history.filter((h) => h.day < firstDay));
        const wind = weather[i] || null;
        const redFlag = ctx.redFlags.some((g) => pointInGeometry(center, g));
        const smoke = Math.max(0, ...ctx.smoke.filter((s) => pointInGeometry(center, s.geometry)).map((s) => s.level));
        const chp = ctx.chp.filter((c) => distanceMiles(c, center) <= CHP_MI).length;
        const result = assess(cluster, info, { past, priorDays, wind, redFlag });
        const passTime = ds.at(-1).acquired;
        const reached = (lvl) => LEVEL_RANK[result.level] >= LEVEL_RANK[lvl];

        statements.push(db.prepare(`
            INSERT INTO snapshots (track_id, taken_at, pass_time, detections, satellites, high_confidence, max_frp, sum_frp,
                extent_mi, drift_mi, drift_bearing, wind_speed, wind_gust, wind_dir, humidity, temp_f, weather_level,
                red_flag, smoke_level, chp_fire_reports, past_days, prior_days, score, level, reasons, rules_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
            t.id, nowIso, passTime, info.count, info.satellites, info.high, info.maxFrp, sumFrp,
            extent, drift, driftBearing, wind?.speed ?? null, wind?.gust ?? null, wind?.dir ?? null, wind?.rh ?? null, wind?.temp ?? null,
            wind?.level ?? null, redFlag ? 1 : 0, smoke, chp, past?.days ?? null, priorDays, result.score, result.level,
            JSON.stringify(result.reasons), RULES_VERSION,
        ));
        statements.push(db.prepare(`
            UPDATE tracks SET last_seen = ?2, lat = ?3, lng = ?4, detections = ?5, passes = passes + 1, max_frp = ?6,
                peak_level = CASE WHEN peak_score IS NULL OR ?7 > peak_score THEN ?8 ELSE peak_level END,
                peak_score = MAX(COALESCE(peak_score, ?7), ?7),
                first_moderate_at = COALESCE(first_moderate_at, ?9),
                first_strong_at = COALESCE(first_strong_at, ?10)
            WHERE id = ?1`).bind(
            t.id, passTime, center[1], center[0], info.count, info.maxFrp, result.score, result.level,
            reached('moderate') ? passTime : null, reached('high') ? passTime : null,
        ));
    });
    await batch(db, statements);
    return tracks.length;
}

// Match tracks to reported incidents; mark quiet, unmatched tracks as not reported (or recurring).
async function labelTracks(db, now, nowIso) {
    const { results: tracks } = await db.prepare(`
        SELECT t.*, (SELECT prior_days FROM snapshots s WHERE s.track_id = t.id ORDER BY s.id DESC LIMIT 1) AS prior_days,
               (SELECT past_days FROM snapshots s WHERE s.track_id = t.id ORDER BY s.id DESC LIMIT 1) AS past_days
        FROM tracks t WHERE t.status IN ('active', 'not_reported', 'recurring') AND t.first_seen >= ?`).bind(iso(now - LABEL_LOOKBACK_MS)).all();
    if (!tracks.length) return 0;
    const { results: incidents } = await db.prepare('SELECT * FROM incidents WHERE started >= ?').bind(iso(now - LABEL_LOOKBACK_MS - MATCH_BEFORE_MS)).all();

    const statements = [];
    for (const t of tracks) {
        const first = Date.parse(t.first_seen);
        const match = incidents
            .filter((i) => {
                const started = Date.parse(i.started);
                return started >= first - MATCH_BEFORE_MS && started <= first + MATCH_AFTER_MS && distanceMiles([t.lng, t.lat], [i.lng, i.lat]) <= MATCH_MI;
            })
            .sort((a, b) => a.started.localeCompare(b.started))[0];
        if (match) {
            statements.push(db.prepare(`
                UPDATE tracks SET status = 'fire', incident_id = ?2, incident_name = ?3, incident_source = ?4,
                    incident_started = ?5, incident_seen = ?6, incident_preexisting = ?7, labeled_at = ?8 WHERE id = ?1`)
                .bind(t.id, match.id, match.name, match.source, match.started, match.first_seen, match.preexisting, nowIso));
        } else if (t.status === 'active' && Date.parse(t.last_seen) < now - QUIET_MS) {
            const recurring = (t.prior_days ?? 0) >= PERSISTENT_DAYS || (t.past_days ?? 0) >= RECURRING_PAST_DAYS;
            statements.push(db.prepare('UPDATE tracks SET status = ?2, labeled_at = ?3 WHERE id = ?1').bind(t.id, recurring ? 'recurring' : 'not_reported', nowIso));
        }
    }
    await batch(db, statements);
    return statements.length;
}

// ---------- Run ----------

async function collect(env) {
    const db = env.DB;
    const site = env.SITE;
    const now = Date.now();
    const nowIso = iso(now);
    const errors = [];
    const run = await db.prepare('INSERT INTO runs (started_at) VALUES (?) RETURNING id').bind(nowIso).first();
    const firstRunAt = (await db.prepare('SELECT MIN(started_at) AS t FROM runs').first()).t;
    const soft = (name, promise, fallback) => promise.catch((err) => {
        errors.push(`${name}: ${err.message}`);
        return fallback;
    });

    const [hotspots, history, baseline, redFlags, smoke, chp, calfire, wfigs] = await Promise.all([
        soft('firms', fetchHotspots(site, now), []),
        soft('history', fetchHistory(site, now), []),
        soft('baseline', fetchBaseline(site), null),
        soft('nws', fetchRedFlags(site), []),
        soft('smoke', fetchSmoke(site, now), []),
        soft('chp', fetchChpFires(site), []),
        soft('calfire', fetchCalfire(site, now), []),
        soft('wfigs', fetchWfigs(now), []),
    ]);
    const incidents = [...calfire, ...wfigs];

    await upsertIncidents(db, incidents, nowIso, firstRunAt);
    const fresh = await insertDetections(db, hotspots, nowIso);
    const { touched, created } = await assignTracks(db, fresh, incidents, now, nowIso);
    const snapshots = await snapshotTracks(db, touched, { baseline, history, redFlags, smoke, chp, errors }, nowIso);
    const labeled = await labelTracks(db, now, nowIso);

    const summary = { new_detections: fresh.length, new_tracks: created, snapshots, labeled, errors: errors.length ? errors.join('; ') : null };
    await db.prepare('UPDATE runs SET finished_at = ?, new_detections = ?, new_tracks = ?, snapshots = ?, labeled = ?, errors = ? WHERE id = ?')
        .bind(iso(Date.now()), summary.new_detections, summary.new_tracks, summary.snapshots, summary.labeled, summary.errors, run.id).run();
    return summary;
}

async function status(db) {
    const [byStatus, runs, totals] = await Promise.all([
        db.prepare('SELECT status, COUNT(*) AS n FROM tracks GROUP BY status').all(),
        db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 5').all(),
        db.prepare('SELECT (SELECT COUNT(*) FROM detections) AS detections, (SELECT COUNT(*) FROM snapshots) AS snapshots, (SELECT COUNT(*) FROM incidents) AS incidents').first(),
    ]);
    return { totals, tracks: Object.fromEntries(byStatus.results.map((r) => [r.status, r.n])), recentRuns: runs.results };
}

export default {
    async scheduled(_event, env, ctx) {
        ctx.waitUntil(collect(env).then((s) => console.log('collect', JSON.stringify(s))));
    },
    async fetch(request, env) {
        if (new URL(request.url).pathname !== '/') return new Response('Not found', { status: 404 });
        return Response.json(await status(env.DB));
    },
};
