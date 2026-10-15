import { escapeHTML as e, formatAcres, formatPercent } from './util.js';

// Named fires that are still open (not fully contained). Used for visitor share links.
export const isShareableFire = (p) => /\b(fire|complex)$/i.test((p?.name || '').trim()) && (p.contained == null || p.contained < 100);

export function hashtag(name) {
    const words = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return `#${words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;
}

export function fireMapUrl(coords, name, origin = location.origin) {
    const [lng, lat] = coords;
    const params = new URLSearchParams({ at: `${lat.toFixed(4)},${lng.toFixed(4)}`, zoom: '11', label: name });
    return `${origin}/?${params}`;
}

export function shareText(p, mapUrl) {
    const where = p.county ? `${p.county} County` : 'California';
    const size = p.acres != null ? formatAcres(p.acres) : 'size not yet reported';
    const contained = p.contained != null ? `, ${formatPercent(p.contained)} contained` : '';
    const tags = [hashtag(p.name), p.county ? hashtag(`${p.county} County`) : null, '#CAwildfire'].filter(Boolean).join(' ');
    return `${p.name}, ${where}: ${size}${contained}, per CAL FIRE.\n\nLive map with wind and smoke: ${mapUrl}\n\n${tags}`;
}

const ICONS = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.259 5.68 5.905-5.68zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12.07C22 6.48 17.52 2 11.93 2S1.86 6.48 1.86 12.07c0 5.02 3.66 9.18 8.44 9.93v-7.02H7.9v-2.91h2.4V9.84c0-2.37 1.41-3.68 3.57-3.68 1.03 0 2.12.19 2.12.19v2.33h-1.2c-1.18 0-1.55.73-1.55 1.48v1.78h2.64l-.42 2.91h-2.22v7.02c4.78-.75 8.44-4.91 8.44-9.93z"/></svg>',
    threads: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.19 4.16c-3.5 0-5.9 2.3-5.9 5.8 0 2.2 1.1 3.9 2.9 4.7-.1.4-.2.8-.2 1.2 0 1.8 1.2 3.2 3.4 3.2 1.9 0 3.3-1.2 3.3-3 0-2-1.4-2.9-3.5-2.9-.5 0-.9 0-1.4.1.2-.7.5-1.4 1.1-1.8.5-.3 1-.4 1.6-.4 1.9 0 3.2 1.4 3.2 3.4 0 3.1-2.3 5.3-5.7 5.3-3.6 0-6.1-2.4-6.1-5.8 0-3.7 2.7-6.6 6.3-6.6.8 0 1.6.2 2.3.4l.6-1.1a8 8 0 0 0-2.9-.5zm0 10.1c1.4 0 2.2.5 2.2 1.5s-.6 1.6-1.7 1.6c-1.1 0-1.8-.7-1.8-1.7 0-.2 0-.5.1-.7.4-.2.8-.3 1.2-.3z"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 11.5c-1.1-2.1-4-6-6.8-8C2.6 1.6 1.6 2 .8 2.7.1 3.3 0 4.9 0 6c0 1.1.4 9.1 6.5 12.7C9.3 20.4 10.8 21.3 12 21.3s2.7-.9 5.5-2.6C23.6 15.1 24 7.1 24 6c0-1.1-.1-2.7-.8-3.3-.8-.7-1.8-1.1-4.4.7C16 5.5 13.1 9.4 12 11.5z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.23h.01c5.46 0 9.91-4.45 9.91-9.91C22 6.45 17.5 2 12.04 2zm5.78 14.08c-.24.68-1.42 1.3-1.95 1.38-.5.08-1.14.12-1.84-.12-.42-.14-.97-.32-1.67-.62-2.94-1.27-4.85-4.24-5-4.43-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1-2.4.26-.28.57-.35.76-.35h.54c.18 0 .41-.07.64.49.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.2-.14.31-.28.48-.14.16-.3.37-.42.5-.14.14-.28.29-.12.56.16.28.7 1.15 1.5 1.86 1.03.92 1.9 1.2 2.17 1.34.28.14.44.12.6-.07.16-.2.7-.82.89-1.1.18-.28.37-.23.62-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.33.07.12.07.68-.17 1.36z"/></svg>',
};

function intent(href, label, icon) {
    return `<a class="share__btn share__btn--${icon}" href="${e(href)}" target="_blank" rel="noopener" aria-label="${e(label)}" title="${e(label)}">${ICONS[icon]}</a>`;
}

export function shareLinksHTML(p, coords) {
    if (!isShareableFire(p) || !coords) return '';
    const mapUrl = fireMapUrl(coords, p.name);
    const text = shareText(p, mapUrl);
    const enc = encodeURIComponent;
    return `
        <div class="share">
            <span class="share__label">Share this fire</span>
            <div class="share__row">
                ${intent(`https://twitter.com/intent/tweet?text=${enc(text)}`, 'Post on X', 'x')}
                ${intent(`https://www.facebook.com/sharer/sharer.php?u=${enc(mapUrl)}`, 'Share on Facebook', 'facebook')}
                ${intent(`https://www.threads.net/intent/post?text=${enc(text)}`, 'Post on Threads', 'threads')}
                ${intent(`https://bsky.app/intent/compose?text=${enc(text)}`, 'Post on Bluesky', 'bluesky')}
                ${intent(`https://wa.me/?text=${enc(text)}`, 'Share on WhatsApp', 'whatsapp')}
            </div>
        </div>`;
}
