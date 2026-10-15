// Builds public/fire-causes.json: California wildfires per year and cause (count and acres) from CAL FIRE FRAP's
// historical perimeter dataset. FRAP republishes it each spring with the previous season, so rerun yearly.
//   npm run causes
import { writeFileSync } from 'node:fs';

const LAYER = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0';
const YEARS = 20;

const meta = await (await fetch(`${LAYER}?f=json`)).json();
const causes = Object.fromEntries(meta.fields.find((f) => f.name === 'CAUSE').domain.codedValues.map((c) => [c.code, c.name]));

const stats = JSON.stringify([
    { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' },
    { statisticType: 'sum', onStatisticField: 'GIS_ACRES', outStatisticFieldName: 'acres' },
]);
const maxYear = (await (await fetch(`${LAYER}/query?where=1%3D1&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: 'max', onStatisticField: 'YEAR_', outStatisticFieldName: 'y' }]))}&f=json`)).json()).features[0].attributes.y;
const from = maxYear - YEARS + 1;
const query = new URLSearchParams({ where: `YEAR_>=${from}`, outStatistics: stats, groupByFieldsForStatistics: 'YEAR_,CAUSE', f: 'json' });
const res = await (await fetch(`${LAYER}/query?${query}`)).json();
if (res.error) throw new Error(JSON.stringify(res.error));

// rows: [year, causeCode, fires, acres]
const rows = res.features
    .map(({ attributes: a }) => [Number(a.YEAR_), a.CAUSE ?? 14, a.n, Math.round(a.acres || 0)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

writeFileSync('public/fire-causes.json', JSON.stringify({ source: 'CAL FIRE FRAP fire perimeters', from, to: maxYear, causes, rows }));
console.log(`Wrote public/fire-causes.json: ${from}–${maxYear}, ${rows.length} rows`);
