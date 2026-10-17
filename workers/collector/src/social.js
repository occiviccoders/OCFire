import { cardUrl, renderCard } from './card.js';

// Posts CAL FIRE-named fires to the California Fire Watch Facebook Page and Instagram account.
// One post when a fire is newly named, then about twice a day while it is still open, spread across
// daytime hours (one update per run, the fire waiting longest first). A final post at 100% contained.
// A separate once-a-day video, recorded elsewhere and stored in KV, goes out at 8 AM, 1 PM, and 6 PM Pacific.
// Agency-reported incidents only; unconfirmed satellite heat is never posted.
// The Facebook history decides what is due. Both get the same caption and a satellite card of that fire.
//
// SOCIAL_MODE: "off" (default), "dry_run" (compose and log without posting), or "live".
// SOCIAL_DAILY_CAP: posts per rolling 24 hours.

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NEW_WINDOW_MS = 12 * HOUR; // announce a fire only if we first saw it this recently
const UPDATE_EVERY_MS = 10 * HOUR; // ~twice a day per fire, within posting hours
const POST_HOURS = [7, 21]; // updates only between 7 AM and 9 PM Pacific; new fires post any time
const REEL_HOURS = [8, 13, 18]; // one recorded clip, reposted morning, afternoon, and evening
const LOOKBACK_MS = 30 * DAY;
const NEW_PER_RUN = 3;
const UPDATES_PER_RUN = 1;
const X_TWEETS = 'https://api.x.com/2/tweets';

const iso = (ms) => new Date(ms).toISOString();
const pacific = (ms, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...opts }).format(new Date(ms));
const pacificHour = (ms) => Number(pacific(ms, { hour: 'numeric', hourCycle: 'h23' }));
const acresText = (a) => (a == null ? 'size not yet reported' : `${Number(a).toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 1 : 0 })} acres`);

export const isNamedFire = (name) => /\b(fire|complex)$/i.test((name || '').trim());

export function hashtag(name) {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return `#${words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;
}

export function mapLink(site, i) {
    const params = new URLSearchParams({ at: `${i.lat.toFixed(4)},${i.lng.toFixed(4)}`, zoom: '11', label: i.name });
    return `${site}/?${params}`;
}

export function compose(kind, i, last, site, now = Date.now()) {
    const tag = hashtag(i.name);
    const where = i.county ? `${i.county} County` : 'California';
    const tags = [tag, i.county ? hashtag(`${i.county} County`) : null, '#CAwildfire'].filter(Boolean).join(' ');
    const contained = i.contained == null ? '' : `, ${Math.round(i.contained)}% contained`;
    const link = mapLink(site, i);
    const mapLine = `See the latest interactive map, with the next 3 days of wind, smoke, and live cameras: ${link}`;
    if (kind === 'new') {
        return `New fire reported: ${i.name}, ${where}. ${acresText(i.acres)}${contained}, per CAL FIRE.\n\n${mapLine}\n\n#NewFire ${tags}`;
    }
    // The time keeps repeat updates on an unchanged fire from being rejected by X as duplicate posts.
    const asOf = `as of ${pacific(now, { hour: 'numeric', minute: '2-digit' })}`;
    if (i.contained >= 100) {
        return `${i.name} (${where}) is 100% contained at ${acresText(i.acres)}, per CAL FIRE ${asOf}.\n\n${mapLine}\n\n${tags}`;
    }
    const grew = last?.acres != null && i.acres != null && i.acres > last.acres ? ` Up from ${acresText(last.acres)}.` : '';
    return `${i.name}, ${where}: ${acresText(i.acres)}${contained} ${asOf}, per CAL FIRE.${grew}\n\n${mapLine}\n\n${tags}`;
}

const SOUTH = new Set(['orange', 'san diego', 'los angeles', 'riverside', 'san bernardino', 'ventura', 'imperial', 'santa barbara', 'san luis obispo']);
const SLOT_LINE = { 8: 'This morning', 13: 'This afternoon', 18: 'This evening' };

export function reelHashtags(i) {
    const county = (i.county || '').trim();
    const tags = [
        hashtag(i.name),
        county ? hashtag(`${county} County`) : null,
        county ? `#${county.replace(/[^A-Za-z0-9]/g, '')}Fire` : null,
        '#CAwildfire', '#CaliforniaWildfire', '#CaliforniaFire', '#Wildfire', '#Wildfires',
        '#California', '#FireSeason', '#FireWatch',
    ];
    if (SOUTH.has(county.toLowerCase())) tags.push('#SoCal', '#SouthernCalifornia');
    if (county.toLowerCase() === 'orange') tags.push('#OCFire', '#OrangeCountyFire');
    return [...new Set(tags.filter(Boolean))].join(' ');
}

export function composeReel(i, site, now = Date.now()) {
    const where = i.county ? `${i.county} County` : 'California';
    const contained = i.contained == null ? '' : `, ${Math.round(i.contained)}% contained`;
    const when = SLOT_LINE[pacificHour(now)] || 'Today';
    return `${when}: ${i.name}, ${where}. ${acresText(i.acres)}${contained}, per CAL FIRE.\n\nSee the latest interactive map, with the next 3 days of wind, smoke, and live cameras: ${mapLink(site, i)}\n\n${reelHashtags(i)}`;
}

export async function reelSubject(db, now = Date.now()) {
    const { results } = await db.prepare("SELECT * FROM incidents WHERE source = 'calfire' AND active = 1 AND started >= ?").bind(iso(now - LOOKBACK_MS)).all();
    const named = results.filter((i) => isNamedFire(i.name) && i.lat != null && (i.contained ?? 0) < 100);
    named.sort((a, b) => (b.acres || 0) - (a.acres || 0) || Date.parse(b.first_seen) - Date.parse(a.first_seen));
    const i = named[0];
    if (!i) return null;
    return { id: i.id, name: i.name, acres: i.acres, contained: i.contained, county: i.county, lat: i.lat, lng: i.lng };
}

const pacificDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// ---------- X (OAuth 1.0a user context) ----------

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function oauthHeader(env, method, url) {
    const oauth = {
        oauth_consumer_key: env.X_API_KEY,
        oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_token: env.X_ACCESS_TOKEN,
        oauth_version: '1.0',
    };
    const params = Object.keys(oauth).sort().map((k) => `${pct(k)}=${pct(oauth[k])}`).join('&');
    const base = `${method}&${pct(url)}&${pct(params)}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_SECRET)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
    oauth.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return `OAuth ${Object.keys(oauth).map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(', ')}`;
}

async function postToX(env, text) {
    const res = await fetch(X_TWEETS, {
        method: 'POST',
        headers: { Authorization: await oauthHeader(env, 'POST', X_TWEETS), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.data?.id) throw new Error(`X ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body.data.id;
}

const PLATFORM = 'facebook';
const IG_PLATFORM = 'instagram';

async function postToFacebook(env, text, imageUrl) {
    if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) throw new Error('Facebook Page token is not configured');
    const res = await fetch(`https://graph.facebook.com/v26.0/${env.FB_PAGE_ID}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: imageUrl, message: text, access_token: env.FB_PAGE_TOKEN }),
        signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new Error(`Facebook ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body.post_id || body.id;
}

async function graph(path, params) {
    const res = await fetch(`https://graph.facebook.com/v26.0/${path}?${params}`, { signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

async function postToInstagram(env, text, imageUrl) {
    if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) throw new Error('Facebook Page token is not configured');
    const account = await graph(env.FB_PAGE_ID, new URLSearchParams({ fields: 'instagram_business_account', access_token: env.FB_PAGE_TOKEN }));
    const igId = account.body.instagram_business_account?.id;
    if (!igId) throw new Error(`Instagram account is not linked (${account.res.status})`);
    const created = await fetch(`https://graph.facebook.com/v26.0/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image_url: imageUrl, caption: text, access_token: env.FB_PAGE_TOKEN }),
        signal: AbortSignal.timeout(20000),
    });
    const container = await created.json().catch(() => ({}));
    if (!created.ok || !container.id) throw new Error(`Instagram media ${created.status}: ${JSON.stringify(container).slice(0, 200)}`);
    let published = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
        const pub = await fetch(`https://graph.facebook.com/v26.0/${igId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ creation_id: container.id, access_token: env.FB_PAGE_TOKEN }),
            signal: AbortSignal.timeout(20000),
        });
        published = await pub.json().catch(() => ({}));
        if (pub.ok && published.id) return published.id;
        const waiting = /not ready|9007|media id is not available/i.test(JSON.stringify(published));
        if (!waiting) throw new Error(`Instagram publish ${pub.status}: ${JSON.stringify(published).slice(0, 200)}`);
    }
    throw new Error(`Instagram publish timed out: ${JSON.stringify(published).slice(0, 200)}`);
}

async function postVideoToFacebook(env, text, videoUrl) {
    if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) throw new Error('Facebook Page token is not configured');
    const res = await fetch(`https://graph.facebook.com/v26.0/${env.FB_PAGE_ID}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ file_url: videoUrl, description: text, access_token: env.FB_PAGE_TOKEN }),
        signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new Error(`Facebook video ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body.id;
}

async function postReelToInstagram(env, text, videoUrl) {
    if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) throw new Error('Facebook Page token is not configured');
    const account = await graph(env.FB_PAGE_ID, new URLSearchParams({ fields: 'instagram_business_account', access_token: env.FB_PAGE_TOKEN }));
    const igId = account.body.instagram_business_account?.id;
    if (!igId) throw new Error(`Instagram account is not linked (${account.res.status})`);
    const created = await fetch(`https://graph.facebook.com/v26.0/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption: text, share_to_feed: 'true', access_token: env.FB_PAGE_TOKEN }),
        signal: AbortSignal.timeout(30000),
    });
    const container = await created.json().catch(() => ({}));
    if (!created.ok || !container.id) throw new Error(`Instagram reel ${created.status}: ${JSON.stringify(container).slice(0, 200)}`);
    let status = null;
    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const check = await graph(container.id, new URLSearchParams({ fields: 'status_code', access_token: env.FB_PAGE_TOKEN }));
        status = check.body.status_code;
        if (status === 'FINISHED') break;
        if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram reel ${status}: ${JSON.stringify(check.body).slice(0, 200)}`);
    }
    if (status !== 'FINISHED') throw new Error(`Instagram reel not ready (${status})`);
    const pub = await fetch(`https://graph.facebook.com/v26.0/${igId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: container.id, access_token: env.FB_PAGE_TOKEN }),
        signal: AbortSignal.timeout(20000),
    });
    const published = await pub.json().catch(() => ({}));
    if (!pub.ok || !published.id) throw new Error(`Instagram reel publish ${pub.status}: ${JSON.stringify(published).slice(0, 200)}`);
    return published.id;
}

// ---------- Run ----------

// Instagram will not wait for a card to be drawn, so the picture is saved first and served by id.
async function imageFor(env, fire, wasm) {
    if (!wasm) return cardUrl(fire);
    try {
        const jpg = await renderCard({
            name: fire.name,
            lat: fire.lat,
            lng: fire.lng,
            acres: fire.acres,
            contained: fire.contained,
            county: fire.county,
        }, wasm);
        const bytes = jpg instanceof Uint8Array ? jpg : new Uint8Array(jpg);
        const id = crypto.randomUUID();
        await env.CARDS.put(`${id}.jpg`, bytes);
        return `https://ocfire-collector.initial-apps.workers.dev/api/card.jpg?id=${id}`;
    } catch (err) {
        console.log('card', err.message);
        return cardUrl(fire);
    }
}

export async function runSocial(env, now = Date.now(), { anyHour = false, wasm = null } = {}) {
    const mode = env.SOCIAL_MODE || 'off';
    if (mode === 'off') return { mode };
    const db = env.DB;
    const cap = Number(env.SOCIAL_DAILY_CAP || 50);

    const [{ results: incidents }, { results: history }, used] = await Promise.all([
        db.prepare("SELECT * FROM incidents WHERE source = 'calfire' AND active = 1 AND started >= ?").bind(iso(now - LOOKBACK_MS)).all(),
        db.prepare("SELECT incident_id, kind, created_at, acres, contained FROM social_posts WHERE platform = ? AND status != 'error' AND kind != 'reel' AND created_at >= ? ORDER BY created_at").bind(PLATFORM, iso(now - LOOKBACK_MS)).all(),
        db.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE platform = ? AND status IN ('posted', 'dry_run', 'error') AND created_at >= ?").bind(PLATFORM, iso(now - DAY)).first(),
    ]);
    const last = new Map(history.map((p) => [p.incident_id, p]));

    const fresh = [];
    const updates = [];
    const seeds = [];
    for (const i of incidents) {
        if (!isNamedFire(i.name) || i.lat == null) continue;
        const prev = last.get(i.id);
        if (!prev) {
            if (now - Date.parse(i.first_seen) < NEW_WINDOW_MS && (i.contained ?? 0) < 100) fresh.push({ kind: 'new', i });
            else seeds.push(i);
            continue;
        }
        // Once we've posted it at 100% contained, the fire is done.
        if (prev.contained >= 100 && (prev.kind !== 'seed' || i.contained >= 100)) continue;
        const due = prev.kind === 'seed' || now - Date.parse(prev.created_at) >= UPDATE_EVERY_MS;
        if (due) updates.push({ kind: 'update', i, prev, waited: prev.kind === 'seed' ? Infinity : now - Date.parse(prev.created_at) });
    }
    fresh.sort((a, b) => (b.i.acres || 0) - (a.i.acres || 0));
    updates.sort((a, b) => b.waited - a.waited || (b.i.acres || 0) - (a.i.acres || 0));
    const hour = pacificHour(now);
    const inHours = anyHour || (hour >= POST_HOURS[0] && hour < POST_HOURS[1]);
    const queue = [...fresh.slice(0, NEW_PER_RUN), ...(inHours ? updates.slice(0, UPDATES_PER_RUN) : [])];

    const insert = db.prepare('INSERT INTO social_posts (incident_id, kind, created_at, status, post_id, text, acres, contained, error, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const nowIso = iso(now);
    // Fires already burning when we started watching: remember them without announcing.
    if (seeds.length) await db.batch(seeds.map((i) => insert.bind(i.id, 'seed', nowIso, 'skipped', null, null, i.acres, i.contained, null, PLATFORM)));

    const budget = Math.max(0, cap - used.n);
    const results = [];
    for (const { kind, i, prev } of queue.slice(0, budget)) {
        const text = compose(kind, i, prev, env.SITE, now);
        const image = await imageFor(env, i, wasm);
        let status = 'dry_run';
        let postId = null;
        let error = null;
        if (mode === 'live') {
            try {
                postId = await postToFacebook(env, text, image);
                status = 'posted';
            } catch (err) {
                status = 'error';
                error = err.message;
            }
        }
        await insert.bind(i.id, kind, nowIso, status, postId, text, i.acres, i.contained, error, PLATFORM).run();
        results.push({ kind, name: i.name, platform: PLATFORM, status, error });

        let igStatus = mode === 'live' ? 'posted' : 'dry_run';
        let igPostId = null;
        let igError = null;
        if (mode === 'live') {
            try {
                igPostId = await postToInstagram(env, text, image);
            } catch (err) {
                igStatus = 'error';
                igError = err.message;
            }
        }
        await insert.bind(i.id, kind, nowIso, igStatus, igPostId, text, i.acres, i.contained, igError, IG_PLATFORM).run();
        results.push({ kind, name: i.name, platform: IG_PLATFORM, status: igStatus, error: igError });
    }
    const reel = await maybePostReel(env, insert, now, mode, used.n + results.filter((r) => r.platform === PLATFORM).length, cap);
    return { mode, new: fresh.length, due: updates.length, seeded: seeds.length, budget, results, reel };
}

// The clip is recorded once a day and saved in KV. This only publishes it.
async function maybePostReel(env, insert, now, mode, used, cap) {
    const hour = pacificHour(now);
    const minute = Number(pacific(now, { minute: '2-digit' }));
    if (!REEL_HOURS.includes(hour) || minute >= 20) return 'later';
    if (used >= cap) return 'cap';
    const meta = await env.CARDS.get('reel/latest.json', { type: 'json' });
    if (!meta?.name || !meta.lat) return 'none';
    const day = pacificDay(now);
    if (meta.day !== day) return 'stale';
    const flag = `reel/posted/${day}/${hour}`;
    if (await env.CARDS.get(flag)) return 'already';
    await env.CARDS.put(flag, '1', { expirationTtl: 60 * 60 * 36 });
    const text = composeReel(meta, env.SITE, now);
    const videoUrl = 'https://ocfire-collector.initial-apps.workers.dev/api/reel.mp4';
    const nowIso = iso(now);
    let status = 'dry_run';
    let postId = null;
    let error = null;
    if (mode === 'live') {
        try {
            postId = await postVideoToFacebook(env, text, videoUrl);
            status = 'posted';
        } catch (err) {
            status = 'error';
            error = err.message;
        }
    }
    await insert.bind(meta.id, 'reel', nowIso, status, postId, text, meta.acres, meta.contained, error, PLATFORM).run();
    let igStatus = mode === 'live' ? 'posted' : 'dry_run';
    let igPostId = null;
    let igError = null;
    if (mode === 'live') {
        try {
            igPostId = await postReelToInstagram(env, text, videoUrl);
        } catch (err) {
            igStatus = 'error';
            igError = err.message;
        }
    }
    await insert.bind(meta.id, 'reel', nowIso, igStatus, igPostId, text, meta.acres, meta.contained, igError, IG_PLATFORM).run();
    return status;
}
