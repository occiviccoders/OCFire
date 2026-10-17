import { chromium } from 'playwright';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const COLLECTOR = 'https://ocfire-collector.initial-apps.workers.dev';
const PAGE_URL = process.env.REEL_URL || 'https://firewatch.occiviccoders.com/?reel=1';
const CI = process.env.CI === 'true';
const W = 1080;
const H = 1920;
const dir = join(tmpdir(), 'ocfire-reel');
mkdirSync(dir, { recursive: true });

const subjectRes = await fetch(`${COLLECTOR}/api/reel/subject`);
if (!subjectRes.ok) throw new Error(`No fire to film (${subjectRes.status})`);
const subject = await subjectRes.json();
console.log('filming', subject.name, subject.acres);

const browser = await chromium.launch({
    headless: CI,
    args: CI
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--disable-background-timer-throttling']
        : ['--use-angle=metal', '--disable-background-timer-throttling'],
});
const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir, size: { width: W, height: H } },
    deviceScaleFactor: 1,
});
await context.addInitScript(() => {
    localStorage.setItem('ocfire.disclaimer.v2', 'yes');
    const style = document.createElement('style');
    style.textContent = `
      .sidebar, .map-actions, .about, #about { display: none !important; }
      .app { height: 100vh; }
      .map-wrap { position: fixed; inset: 0; width: 100vw; height: 100vh; }
      .maplibregl-ctrl-top-right { top: 24px; right: 24px; }
      .timeline, .legend { display: none !important; }
      .reel-card { position: fixed; left: 40px; top: 48px; z-index: 8; font-family: Inter, system-ui, sans-serif; color: #fff; text-shadow: 0 2px 16px rgba(0,0,0,0.85); }
      .reel-bar { position: fixed; left: 40px; right: 40px; bottom: 56px; z-index: 8; font-family: Inter, system-ui, sans-serif; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
      .reel-bar .track { height: 22px; border-radius: 11px; background: rgba(255,255,255,0.22); overflow: hidden; }
      .reel-bar .fill { height: 100%; width: 0; background: #ff5a00; }
      .reel-bar .meta { display: flex; justify-content: space-between; margin-top: 12px; font-size: 30px; font-weight: 700; }
      .reel-card small { display: block; letter-spacing: 0.16em; font-size: 26px; color: #ffd166; font-weight: 700; }
      .reel-card b { display: block; font-size: 76px; line-height: 1.05; margin-top: 6px; }
      .reel-card em { display: block; margin-top: 8px; font-style: normal; font-size: 32px; font-weight: 600; }
      .reel-end { position: fixed; inset: 0; z-index: 9; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 48px 140px; background: linear-gradient(to top, rgba(8,10,14,0.94) 0%, rgba(8,10,14,0.72) 28%, rgba(8,10,14,0) 62%); font-family: Inter, system-ui, sans-serif; color: #fff; }
      .reel-end p { margin: 0 0 22px; font-size: 34px; font-weight: 650; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
      .reel-end .btn { background: #ff5a00; color: #1a0a00; font-size: 46px; font-weight: 800; line-height: 1.15; text-align: center; border-radius: 22px; padding: 32px 28px; }
    `;
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
});
const page = await context.newPage();
const videoStarted = Date.now();
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction(() => window.__ocfire?.state?.incidents?.features?.length > 0 && window.__ocfire?.state?.wind?.forecast, null, { timeout: 60000 });
const actionAt = ((Date.now() - videoStarted) / 1000).toFixed(2);
console.log('ACTION', actionAt);

await page.evaluate(() => {
    const card = document.createElement('div');
    card.className = 'reel-card';
    card.innerHTML = '<small>CALIFORNIA</small><b>Live wind</b>';
    document.body.appendChild(card);
    window.__ocfire.map.jumpTo({ center: [-119.4, 37.1], zoom: 5.15 });
});
await page.waitForTimeout(2000);

const facts = await page.evaluate((name) => {
    const feature = window.__ocfire.state.incidents.features.find((f) => f.properties.name === name);
    if (!feature) throw new Error(`${name} is not on the map`);
    const button = [...document.querySelectorAll('[data-id]')].find((el) => el.textContent.includes(name));
    button?.click();
    const acres = feature.properties.acres;
    const contained = feature.properties.contained;
    return {
        acres: acres == null ? 'size not yet reported' : `${Math.round(acres)} acres`,
        contained: contained == null ? 'containment not yet reported' : `${Math.round(contained)}% contained`,
        center: feature.geometry.coordinates,
    };
}, subject.name);
await page.evaluate((card) => {
    const place = card.county ? `${card.county} County` : 'California';
    document.querySelector('.reel-card').innerHTML = `<small>${place.toUpperCase()}</small><b>${card.name}</b><em>${card.acres} · ${card.contained}</em>`;
}, { ...subject, ...facts });
await page.waitForTimeout(1600);
await page.evaluate(() => {
    document.querySelectorAll('.maplibregl-popup').forEach((el) => el.remove());
    const bar = document.createElement('div');
    bar.className = 'reel-bar';
    bar.innerHTML = '<div class="track"><div class="fill"></div></div><div class="meta"><span class="when"></span><span>Wind through the day</span></div>';
    document.body.appendChild(bar);
});
await page.waitForTimeout(2200);

const LAST = 18;
for (let hour = 0; hour <= LAST; hour++) {
    await page.evaluate(({ hour, last }) => {
        const range = document.getElementById('tl-range');
        range.value = String(hour);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        const times = window.__ocfire.state.wind.forecast.times;
        const when = new Date(times[hour]).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric' });
        document.querySelector('.reel-bar .when').textContent = when;
        document.querySelector('.reel-bar .fill').style.width = `${(hour / last) * 100}%`;
    }, { hour, last: LAST });
    await page.waitForTimeout(180);
}
await page.waitForTimeout(600);

await page.evaluate(() => {
    const box = document.getElementById('toggle-satellite');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(3200);

await page.evaluate((center) => {
    window.__ocfire.map.flyTo({ center, zoom: 15.6, duration: 1500, essential: true });
}, facts.center);
await page.waitForTimeout(2900);

await page.evaluate(() => {
    document.querySelector('.reel-bar')?.remove();
    const end = document.createElement('div');
    end.className = 'reel-end';
    end.innerHTML = '<p>Wind, smoke, and live cameras</p><div class="btn">See the latest interactive map</div>';
    document.body.appendChild(end);
});
await page.waitForTimeout(2800);

const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();
const cut = join(dir, 'cut.mp4');
const out = join(dir, 'reel.mp4');
const encode = (args) => {
    const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('ffmpeg failed');
};
encode(['-y', '-ss', actionAt, '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', cut]);
encode(['-y', '-i', cut, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);

const probe = spawnSync(ffmpeg, ['-ss', '12', '-i', out, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
const luma = Number(`${probe.stdout}\n${probe.stderr}`.match(/YAVG[=:]([0-9.]+)/)?.[1]);
console.log('satellite luma', luma);
if (!Number.isFinite(luma) || luma < 25) throw new Error('Satellite frame looks blank, so this clip was not uploaded');

if (!process.env.ADMIN_TOKEN) {
    console.log('no ADMIN_TOKEN, left the file at', out);
    process.exit(0);
}
const params = new URLSearchParams({
    id: subject.id,
    name: subject.name,
    county: subject.county || '',
    lat: String(subject.lat),
    lng: String(subject.lng),
    acres: subject.acres == null ? '' : String(subject.acres),
    contained: subject.contained == null ? '' : String(subject.contained),
});
const uploaded = await fetch(`${COLLECTOR}/api/reel.mp4?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}`, 'content-type': 'video/mp4' },
    body: readFileSync(out),
});
const body = await uploaded.json().catch(() => ({}));
if (!uploaded.ok) throw new Error(`Upload failed ${uploaded.status}: ${JSON.stringify(body).slice(0, 200)}`);
console.log('uploaded', JSON.stringify(body));
