export const OC_CENTER = [-117.823059, 33.669445];
export const INITIAL_ZOOM = 7;

// [west, south, east, north]
export const CA_BBOX = [-124.5, 32.4, -114.1, 42.1];

export const NEARBY_RADIUS_MI = 150;
export const REFRESH_MS = 5 * 60 * 1000;

// Statewide wind forecast grid. Only points inside WIND_MASK are fetched (~500); each counts as one
// Open-Meteo call against the free 10k/day limit, so it refreshes every 3 hours (never while the tab is hidden) and is cached in localStorage.
export const WIND_GRID = { bbox: [-124.6, 32.4, -114.0, 42.1], step: 0.35 };
export const WIND_FORECAST_HOURS = 72;
export const WIND_REFRESH_MS = 3 * 60 * 60 * 1000;

// California plus ~30 mi of coastal water and border buffer, [lng, lat].
export const WIND_MASK = [
    [-125.0, 42.3], [-119.6, 42.3], [-119.6, 39.3], [-114.0, 35.1], [-113.9, 32.3], [-117.4, 32.2],
    [-119.5, 32.9], [-121.3, 34.2], [-122.6, 36.4], [-123.8, 37.9], [-124.6, 39.6], [-125.0, 40.5],
];

// Dedicated full-resolution forecast points (the grid is too coarse for canyon winds): OC first, then
// the corridors where California's named offshore wind events drive the big fires.
export const FORECAST_POINTS = [
    { id: 'central', group: 'Orange County', name: 'Central OC', detail: 'Irvine', coords: OC_CENTER },
    { id: 'foothills', group: 'Orange County', name: 'OC foothills', detail: 'Silverado / Santiago Canyon — Santa Ana gap', coords: [-117.63, 33.75] },
    { id: 'malibu', group: 'Santa Ana', name: 'Malibu', detail: 'Santa Monica Mountains (Woolsey, Franklin, Palisades)', coords: [-118.78, 34.04] },
    { id: 'altadena', group: 'Santa Ana', name: 'Altadena', detail: 'San Gabriel foothills (Eaton)', coords: [-118.13, 34.19] },
    { id: 'cajon', group: 'Santa Ana', name: 'Cajon Pass', detail: 'I-15 gap into the Inland Empire', coords: [-117.45, 34.31] },
    { id: 'ramona', group: 'Santa Ana', name: 'San Diego East County', detail: 'Ramona / Alpine (Cedar, Witch)', coords: [-116.85, 32.95] },
    { id: 'montecito', group: 'Sundowner', name: 'Santa Barbara', detail: 'Montecito foothills (Thomas)', coords: [-119.64, 34.45] },
    { id: 'eastbay', group: 'Diablo', name: 'East Bay hills', detail: 'Berkeley / Oakland hills (1991 Tunnel)', coords: [-122.22, 37.86] },
    { id: 'napa', group: 'Diablo', name: 'Napa / Sonoma', detail: 'Calistoga / Santa Rosa (Tubbs, Glass)', coords: [-122.62, 38.55] },
    { id: 'paradise', group: 'North wind', name: 'Paradise', detail: 'Butte County ridge (Camp)', coords: [-121.60, 39.76] },
];

export const BASEMAPS = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    satelliteTiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

export const LABEL_FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];
