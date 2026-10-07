import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, query, isInitialized, resetDatabase } from './db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(root, 'public')));

const LISTING_COLUMNS = `
  id, slug, name, kind, description, address, neighborhood, lat, lng, transit, phone,
  website, cost, tags, is_free, saves, category_slug, category_name, category_color,
  miles::float AS miles, walk_minutes, train_minutes, borough`;

const SORTS = {
  distance: 'miles ASC NULLS LAST, name',
  saves: 'saves DESC, miles ASC NULLS LAST',
  name: 'name',
};

app.get('/api/meta', async (_req, res) => {
  const [home] = await query('SELECT label, address, lat, lng FROM home_base');
  const categories = await query(`
    SELECT c.slug, c.name, c.blurb, c.badge, c.color,
           count(v.id)::int AS count
    FROM categories c
    LEFT JOIN listing_view v ON v.category_slug = c.slug OR c.slug = ANY(v.tags)
    GROUP BY c.id ORDER BY c.sort_order`);
  const [{ total, walkable, within45, free }] = await query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE walk_minutes <= 20)::int AS walkable,
           count(*) FILTER (WHERE train_minutes <= 45)::int AS within45,
           count(*) FILTER (WHERE is_free)::int AS free
    FROM listing_view`);
  const boroughs = await query(`
    SELECT borough AS name, count(*)::int AS count FROM listing_view
    GROUP BY borough ORDER BY count(*) DESC`);
  res.json({ home, categories, boroughs, total, walkable, within45, free });
});

app.get('/api/listings', async (req, res) => {
  const where = [];
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };

  const { category, q, sort, kind } = req.query;
  if (category) {
    const p = add(String(category));
    where.push(`(category_slug = ${p} OR ${p} = ANY(tags))`);
  }
  if (kind) where.push(`kind = ${add(String(kind))}`);
  if (q && String(q).trim()) {
    const p = add(String(q).trim().slice(0, 200));
    where.push(`(document @@ websearch_to_tsquery('english', ${p})
                 OR name ILIKE '%' || ${p} || '%' OR neighborhood ILIKE '%' || ${p} || '%')`);
  }
  const tags = String(req.query.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length) where.push(`tags @> ${add(tags)}::text[]`);
  if (req.query.walkable === '1') where.push('walk_minutes <= 20');
  const maxTrain = Number(req.query.maxTrain);
  if (maxTrain > 0) where.push(`(walk_minutes <= 20 OR train_minutes <= ${add(maxTrain)})`);
  if (req.query.borough) where.push(`borough = ${add(String(req.query.borough))}`);
  if (req.query.free === '1') where.push('is_free');

  const limit = Math.min(Number(req.query.limit) || 500, 500);
  const rows = await query(`
    SELECT ${LISTING_COLUMNS} FROM listing_view
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${SORTS[sort] || SORTS.distance}
    LIMIT ${limit}`, params);
  res.json(rows);
});

app.get('/api/listings/:slug', async (req, res) => {
  const [row] = await query(`SELECT ${LISTING_COLUMNS} FROM listing_view WHERE slug = $1`, [req.params.slug]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/listings/:slug/save', async (req, res) => {
  const delta = req.body?.saved === false ? -1 : 1;
  const [row] = await query(
    'UPDATE listings SET saves = greatest(saves + $2, 0) WHERE slug = $1 RETURNING saves',
    [req.params.slug, delta]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/submissions', async (req, res) => {
  const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;
  const name = clean(req.body?.name, 200);
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const [row] = await query(
    `INSERT INTO submissions (name, category_slug, address, website, why, submitter)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, clean(req.body.category, 50), clean(req.body.address, 300),
     clean(req.body.website, 300), clean(req.body.why, 2000), clean(req.body.submitter, 200)]);
  res.status(201).json(row);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const db = await getDb();
if (!(await isInitialized())) {
  console.log('Empty database — loading schema and seed data…');
  await resetDatabase();
}
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Petal Health NYC on http://localhost:${port} using ${db.label}`));
