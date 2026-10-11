// Disclaimer + data credits dialog. Shown on first visit and must be accepted before using the map;
// bump the key version whenever the disclaimer text changes materially so everyone sees it again.
const ACCEPT_KEY = 'ocfire.disclaimer.v1';

for (const el of document.querySelectorAll('[data-year]')) el.textContent = new Date().getFullYear();

const dialog = document.getElementById('about');
const accept = document.getElementById('about-accept');

const accepted = () => {
    try {
        return localStorage.getItem(ACCEPT_KEY) === 'yes';
    } catch {
        return false;
    }
};

function open(section = 'disclaimer') {
    accept.textContent = accepted() ? 'Close' : 'I understand. Show the map';
    if (!dialog.open) dialog.showModal();
    const scroller = dialog.querySelector('.about__scroll');
    scroller.scrollTop = section === 'disclaimer' ? 0 : document.getElementById(`about-${section}`).offsetTop - scroller.offsetTop;
}

accept.addEventListener('click', () => {
    try {
        localStorage.setItem(ACCEPT_KEY, 'yes');
    } catch {
        // storage unavailable: they'll just see it again next visit
    }
    dialog.close();
});

// Until accepted, Escape doesn't dismiss it.
dialog.addEventListener('cancel', (ev) => {
    if (!accepted()) ev.preventDefault();
});

document.addEventListener('click', (ev) => {
    const trigger = ev.target.closest('[data-about]');
    if (trigger) open(trigger.dataset.about);
});

export function showDisclaimerIfNeeded() {
    if (!accepted()) open('disclaimer');
}
