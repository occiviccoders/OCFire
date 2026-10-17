// Posting runs only through the end of an approved month. The month after that
// needs a click from the email, or Facebook and Instagram go quiet.

const HOUR = 3600000;
const DAY = 24 * HOUR;
const UNTIL_KEY = 'social/approved-until';
const COLLECTOR = 'https://ocfire-collector.initial-apps.workers.dev';

const partsOf = (ms) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
};

export function pacificMonthKey(ms) {
    const p = partsOf(ms);
    return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

// UTC instant of midnight at the start of a Pacific month. month is 1-12.
export function pacificMonthStart(year, month) {
    let t = Date.UTC(year, month - 1, 1, 10, 0, 0);
    for (let i = 0; i < 4; i++) {
        const p = partsOf(t);
        const want = Date.UTC(year, month - 1, 1);
        const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
        if (want === got) return t;
        t += want - got;
    }
    return t;
}

const monthEnd = (key) => {
    const [year, month] = key.split('-').map(Number);
    return pacificMonthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
};

const monthLabel = (key) => {
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sign(secret, month) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`social-approve:${month}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const same = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

async function readUntil(env, now) {
    const raw = await env.CARDS.get(UNTIL_KEY);
    if (raw) return Number(raw);
    const until = monthEnd(pacificMonthKey(now));
    await env.CARDS.put(UNTIL_KEY, String(until));
    return until;
}

async function sendApprovalMail(env, month, until) {
    const token = await sign(env.ADMIN_TOKEN, month);
    const link = `${COLLECTOR}/api/social/approve?month=${month}&token=${token}`;
    const label = monthLabel(month);
    const stops = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' }).format(new Date(until));
    const to = env.SOCIAL_EMAIL_TO || 'info@initialapps.com';
    const from = env.SOCIAL_EMAIL_FROM || 'noreply@occiviccoders.com';
    await env.EMAIL.send({
        to,
        from: { email: from, name: 'California Fire Watch' },
        subject: `Approve ${label} posts for California Fire Watch`,
        text: `Facebook and Instagram posting stops on ${stops} unless you approve ${label}.\n\nApprove ${label}:\n${link}\n\nIf you do nothing, posts stop and stay stopped.`,
        html: `<p>Facebook and Instagram posting stops on ${escapeHtml(stops)} unless you approve ${escapeHtml(label)}.</p><p><a href="${escapeHtml(link)}">Approve ${escapeHtml(label)}</a></p><p>If you do nothing, posts stop and stay stopped.</p>`,
    });
    await env.CARDS.put(`social/approval-sent/${month}`, new Date().toISOString(), { expirationTtl: 50 * DAY / 1000 });
    await env.CARDS.put('social/approval-introduced', '1');
}

export async function ensureApproval(env, now = Date.now()) {
    const until = await readUntil(env, now);
    const month = now >= until ? pacificMonthKey(now) : pacificMonthKey(until);
    const covered = until >= monthEnd(month);
    let email = null;
    if (!covered && env.ADMIN_TOKEN && env.EMAIL) {
        const last = Date.parse(await env.CARDS.get(`social/approval-sent/${month}`) || '') || 0;
        const introduced = await env.CARDS.get('social/approval-introduced');
        const daysLeft = (until - now) / DAY;
        const remind = daysLeft <= 3 || now >= until;
        if ((!introduced || remind) && (!last || now - last > 20 * HOUR)) {
            try {
                await sendApprovalMail(env, month, until);
                email = 'sent';
            } catch (err) {
                email = err.message || 'failed';
            }
        }
    }
    return { ok: now < until, until, month, email };
}

export async function approveMonth(env, month, token) {
    if (!/^\d{4}-\d{2}$/.test(month || '') || !env.ADMIN_TOKEN) return { ok: false };
    const expected = await sign(env.ADMIN_TOKEN, month);
    if (!same(expected, token || '')) return { ok: false };
    const until = Math.max(Number(await env.CARDS.get(UNTIL_KEY)) || 0, monthEnd(month));
    await env.CARDS.put(UNTIL_KEY, String(until));
    return { ok: true, until, month, label: monthLabel(month) };
}

export function approvalPage(result) {
    const title = result.ok ? `${result.label} posts are approved` : 'This approval link is not valid';
    const body = result.ok
        ? `Facebook and Instagram posts continue through ${result.label}. They stop after that unless you approve the next month.`
        : 'Ask for a new link from the monthly email.';
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#0d0f12;color:#fff;font-family:system-ui,sans-serif"><main style="max-width:32rem;margin:0 auto;padding:4rem 1.5rem"><p style="letter-spacing:.16em;color:#ffd166;font-size:.8rem;font-weight:700">CALIFORNIA FIRE WATCH</p><h1 style="font-size:2rem;line-height:1.15">${escapeHtml(title)}</h1><p style="font-size:1.1rem;line-height:1.5">${escapeHtml(body)}</p></main></body></html>`;
}
