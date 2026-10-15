// Posts CAL FIRE-named fires to X: once when a new fire appears, then an update at most daily while it's
// active and its size or containment has changed. Agency-reported incidents only; unconfirmed satellite
// heat is never posted.
//
// SOCIAL_MODE: "off" (default), "dry_run" (compose and log to social_posts without posting), or "live".
// SOCIAL_DAILY_CAP: posts per rolling 24 hours (X's free tier allows only a handful a day).

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NEW_WINDOW_MS = 12 * HOUR; // announce a fire only if we first saw it this recently
const UPDATE_EVERY_MS = 23 * HOUR; // just under a day, so daily updates don't drift later
const LOOKBACK_MS = 30 * DAY;
const PER_RUN = 4;
const X_TWEETS = 'https://api.x.com/2/tweets';

const iso = (ms) => new Date(ms).toISOString();
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

export function compose(kind, i, last, site) {
    const tag = hashtag(i.name);
    const where = i.county ? `${i.county} County` : 'California';
    const contained = i.contained == null ? '' : `, ${Math.round(i.contained)}% contained`;
    const link = mapLink(site, i);
    if (kind === 'new') {
        return `New fire reported: ${i.name}, ${where}. ${acresText(i.acres)}${contained}, per CAL FIRE.\n\nLive map with wind and smoke: ${link}\n\n${tag} #CAwildfire`;
    }
    if (i.contained >= 100) {
        return `${tag} is 100% contained at ${acresText(i.acres)}, per CAL FIRE (${where}).\n\nMap: ${link}`;
    }
    const grew = last?.acres != null && i.acres != null && i.acres !== last.acres ? ` (was ${acresText(last.acres).replace(' acres', '')})` : '';
    return `${tag} update, ${where}: ${acresText(i.acres)}${grew}${contained}, per CAL FIRE.\n\nSee the latest on the map: ${link}\n\n#CAwildfire`;
}

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

// ---------- Run ----------

export async function runSocial(env, now = Date.now()) {
    const mode = env.SOCIAL_MODE || 'off';
    if (mode === 'off') return { mode };
    const db = env.DB;
    const cap = Number(env.SOCIAL_DAILY_CAP || 15);

    const [{ results: incidents }, { results: history }, used] = await Promise.all([
        db.prepare("SELECT * FROM incidents WHERE source = 'calfire' AND active = 1 AND started >= ?").bind(iso(now - LOOKBACK_MS)).all(),
        db.prepare("SELECT incident_id, created_at, acres, contained FROM social_posts WHERE status != 'error' AND created_at >= ? ORDER BY created_at").bind(iso(now - LOOKBACK_MS)).all(),
        db.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE status IN ('posted', 'dry_run', 'error') AND created_at >= ?").bind(iso(now - DAY)).first(),
    ]);
    const last = new Map(history.map((p) => [p.incident_id, p]));

    const queue = [];
    const seeds = [];
    for (const i of incidents) {
        if (!isNamedFire(i.name) || i.lat == null) continue;
        const prev = last.get(i.id);
        if (!prev) {
            const fresh = now - Date.parse(i.first_seen) < NEW_WINDOW_MS && (i.contained ?? 0) < 100;
            if (fresh) queue.push({ kind: 'new', i });
            else seeds.push(i);
        } else if (now - Date.parse(prev.created_at) >= UPDATE_EVERY_MS && (i.acres !== prev.acres || i.contained !== prev.contained)) {
            queue.push({ kind: 'update', i, prev });
        }
    }
    queue.sort((a, b) => (a.kind === b.kind ? (b.i.acres || 0) - (a.i.acres || 0) : a.kind === 'new' ? -1 : 1));

    const insert = db.prepare('INSERT INTO social_posts (incident_id, kind, created_at, status, post_id, text, acres, contained, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const nowIso = iso(now);
    // Fires already burning when we started watching: remember them without announcing.
    if (seeds.length) await db.batch(seeds.map((i) => insert.bind(i.id, 'seed', nowIso, 'skipped', null, null, i.acres, i.contained, null)));

    const budget = Math.max(0, Math.min(PER_RUN, cap - used.n));
    const results = [];
    for (const { kind, i, prev } of queue.slice(0, budget)) {
        const text = compose(kind, i, prev, env.SITE);
        let status = 'dry_run';
        let postId = null;
        let error = null;
        if (mode === 'live') {
            try {
                postId = await postToX(env, text);
                status = 'posted';
            } catch (err) {
                status = 'error';
                error = err.message;
            }
        }
        await insert.bind(i.id, kind, nowIso, status, postId, text, i.acres, i.contained, error).run();
        results.push({ kind, name: i.name, status, error });
    }
    return { mode, queued: queue.length, seeded: seeds.length, budget, results };
}
