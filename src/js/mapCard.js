import * as maplibregl from 'maplibre-gl';

// Matches the `tab-port` Sass breakpoint, where the layout stacks map over sidebar.
const COMPACT = window.matchMedia('(max-width: 56.25em)');

const sheet = document.getElementById('sheet');
const body = sheet.querySelector('.sheet__body');
let owner = null;

function showSheet(card, html) {
    owner = card;
    body.innerHTML = html;
    body.scrollTop = 0;
    sheet.hidden = false;
    sheet.style.transform = '';
}

export function closeSheet() {
    owner = null;
    sheet.hidden = true;
    body.innerHTML = '';
}

// Pixels of the map hidden behind the open sheet (0 on desktop or when closed).
export function sheetOverlap(map) {
    if (sheet.hidden) return 0;
    return Math.max(0, map.getContainer().getBoundingClientRect().bottom - sheet.getBoundingClientRect().top);
}

// Pan just enough that a tapped point isn't hidden behind the sheet.
function keepVisible(map, lngLat) {
    const overlap = sheetOverlap(map);
    if (!overlap) return;
    const visible = map.getContainer().clientHeight - overlap;
    const y = map.project(lngLat).y;
    if (y > visible - 40) map.panBy([0, y - visible / 2], { duration: 500 });
}

// Same calls as maplibregl.Popup, but on small screens the content opens in a bottom sheet instead.
export function createMapCard(map, options) {
    const popup = new maplibregl.Popup(options);
    let lngLat = null;
    let html = '';
    const card = {
        setLngLat(ll) {
            lngLat = ll;
            popup.setLngLat(ll);
            return card;
        },
        setHTML(h) {
            html = h;
            popup.setHTML(h);
            if (owner === card) body.innerHTML = h;
            return card;
        },
        addTo(_map, { pan = true } = {}) {
            if (COMPACT.matches) {
                popup.remove();
                showSheet(card, html);
                if (pan && lngLat) keepVisible(map, lngLat);
            } else {
                if (owner === card) closeSheet();
                popup.addTo(map);
            }
            return card;
        },
        remove() {
            popup.remove();
            if (owner === card) closeSheet();
            return card;
        },
        isOpen() {
            return popup.isOpen() || owner === card;
        },
    };
    return card;
}

sheet.querySelector('.sheet__close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !sheet.hidden) closeSheet();
});
COMPACT.addEventListener('change', closeSheet);

// Swipe the handle down to dismiss.
const handle = sheet.querySelector('.sheet__handle');
let dragStart = null;
handle.addEventListener('touchstart', (ev) => {
    dragStart = ev.touches[0].clientY;
}, { passive: true });
handle.addEventListener('touchmove', (ev) => {
    if (dragStart == null) return;
    const dy = Math.max(0, ev.touches[0].clientY - dragStart);
    sheet.style.transform = `translateY(${dy}px)`;
}, { passive: true });
handle.addEventListener('touchend', (ev) => {
    if (dragStart == null) return;
    const dy = ev.changedTouches[0].clientY - dragStart;
    dragStart = null;
    if (dy > 80) closeSheet();
    else sheet.style.transform = '';
});
