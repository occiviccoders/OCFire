import { formatHour } from './ocForecast.js';

const PLAY_INTERVAL_MS = 650;

// Forecast-hour scrubber floating over the map. Calls onChange(hourIndex).
export function createTimeline(onChange) {
    const root = document.getElementById('timeline');
    const range = document.getElementById('tl-range');
    const play = document.getElementById('tl-play');
    const label = document.getElementById('tl-label');
    const ticks = document.getElementById('tl-ticks');
    const riskStrip = document.getElementById('tl-risk');
    let times = [];
    let timer = null;

    function setHour(h, { emit = true } = {}) {
        range.value = String(h);
        const offset = h === 0 ? 'Now' : `+${h}h`;
        label.innerHTML = `<strong>${formatHour(times[h])}</strong> <span>${offset}</span>`;
        if (emit) onChange(h);
    }

    function stop() {
        clearInterval(timer);
        timer = null;
        play.textContent = '▶';
        play.setAttribute('aria-label', 'Play forecast');
    }

    play.addEventListener('click', () => {
        if (timer) return stop();
        play.textContent = '❚❚';
        play.setAttribute('aria-label', 'Pause forecast');
        timer = setInterval(() => setHour((Number(range.value) + 1) % times.length), PLAY_INTERVAL_MS);
    });
    range.addEventListener('input', () => {
        stop();
        setHour(Number(range.value));
    });

    return {
        setTimes(newTimes, series) {
            times = newTimes;
            range.max = String(times.length - 1);
            const pct = (i) => (i / (times.length - 1)) * 100;
            ticks.innerHTML = times
                .map((t, i) => (new Date(t).getHours() === 0 ? `<span style="left:${pct(i)}%">${new Date(t).toLocaleDateString([], { weekday: 'short' })}</span>` : ''))
                .join('');
            // Fire-weather strip under the slider, one segment per hour, using the OC series.
            riskStrip.innerHTML = series
                .map((s, i) => (s.level === 'normal' ? '' : `<i class="risk-${s.level}" style="left:${pct(i)}%;width:${100 / (times.length - 1)}%"></i>`))
                .join('');
            setHour(Math.min(Number(range.value), times.length - 1), { emit: false });
        },
        setHour,
        setVisible(visible) {
            root.hidden = !visible;
            if (!visible) stop();
        },
    };
}
