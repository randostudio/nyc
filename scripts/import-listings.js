// Validates listing JSON files and turns them into an idempotent SQL insert.
//
//   node scripts/import-listings.js out.sql file1.json [file2.json ...]
//
// Each JSON file is an array of objects with: category, slug, name, kind, description,
// address, neighborhood, lat, lng, transit, phone, website, cost, tags, is_free, source_url.
// Rows that fail validation or sit outside ~45 min by train from home base are reported and skipped.
import { readFile, writeFile } from 'node:fs/promises';

const HOME = { lat: 40.7193, lng: -73.9926 };
const MAX_TRAIN_MINUTES = 45; // same formula as listing_view.train_minutes (incl. +10 min PATH transfer for NJ)
const CATEGORIES = new Set(['doctors', 'mental-health', 'workouts', 'clubs', 'beauty', 'resources']);
const TAGS = new Set(['free', 'low-cost', 'sliding-scale', 'student-friendly', 'no-insurance-ok', 'medicaid',
  'women-focused', 'lgbtq-affirming', 'walk-in', 'confidential', 'telehealth', '24-7', 'evening-hours',
  'beginner-friendly', 'outdoor', 'spanish', 'chinese', 'yoga', 'pilates']);

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error('usage: node scripts/import-listings.js out.sql file.json [...]');
  process.exit(1);
}

function miles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const text = (v) => (v == null || String(v).trim() === '' ? 'NULL::text' : `'${String(v).trim().replace(/'/g, "''")}'`);
const num = (v) => (v == null ? 'NULL::float8' : `${Number(v)}::float8`);

const seen = new Set();
const rows = [];
const skipped = [];

for (const file of files) {
  const items = JSON.parse(await readFile(file, 'utf8'));
  for (const r of items) {
    const why = [];
    if (!CATEGORIES.has(r.category)) why.push(`bad category ${r.category}`);
    for (const key of ['slug', 'name', 'kind', 'description', 'neighborhood']) if (!r[key]) why.push(`missing ${key}`);
    if (r.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) why.push('bad slug');
    if (seen.has(r.slug)) why.push('duplicate slug');
    const hasPoint = typeof r.lat === 'number' && typeof r.lng === 'number';
    if ((r.lat == null) !== (r.lng == null)) why.push('half a coordinate');
    if (hasPoint) {
      if (r.lat < 40.55 || r.lat > 40.92 || r.lng < -74.1 || r.lng > -73.7) why.push(`coords outside NYC (${r.lat}, ${r.lng})`);
      const train = Math.ceil(10 + miles(HOME, r) * 5 + (/,\s*NJ\b/i.test(r.address || '') ? 10 : 0));
      if (train > MAX_TRAIN_MINUTES) why.push(`~${train} min by train`);
    }
    if (r.website && !/^https?:\/\//.test(r.website)) why.push('bad website');
    if (why.length) { skipped.push(`${r.slug || r.name}: ${why.join('; ')}`); continue; }

    seen.add(r.slug);
    const tags = [...new Set((r.tags || []).filter((t) => TAGS.has(t)))];
    if (r.is_free && !tags.includes('free')) tags.unshift('free');
    rows.push(`  (${[
      text(r.category), text(r.slug), text(r.name), text(r.kind), text(r.description), text(r.address),
      text(r.neighborhood), num(hasPoint ? r.lat : null), num(hasPoint ? r.lng : null), text(r.transit),
      text(r.phone), text(r.website), text(r.cost),
      tags.length ? `ARRAY[${tags.map(text).join(',')}]::text[]` : `'{}'::text[]`,
      r.is_free ? 'true' : 'false', text(r.source_url),
    ].join(', ')})`);
  }
}

const sql = `INSERT INTO listings
  (category_id, slug, name, kind, description, address, neighborhood, lat, lng, transit, phone, website, cost, tags, is_free, source_url)
SELECT c.id, v.slug, v.name, v.kind, v.description, v.address, v.neighborhood, v.lat, v.lng,
       v.transit, v.phone, v.website, v.cost, v.tags, v.is_free, v.source_url
FROM (VALUES
${rows.join(',\n')}
) AS v(cat, slug, name, kind, description, address, neighborhood, lat, lng, transit, phone, website, cost, tags, is_free, source_url)
JOIN categories c ON c.slug = v.cat
ON CONFLICT (slug) DO NOTHING;
`;
await writeFile(out, sql);
console.log(`${rows.length} rows written to ${out}; ${skipped.length} skipped`);
for (const s of skipped) console.log('  skip', s);
