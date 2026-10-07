# Petal Health NYC

A directory for college women in NYC: doctors, mental health care, workouts (including yoga and Pilates), clubs, beauty (hair, nails, brows, makeup, facials) and resources. Every listing is measured from **303 Broome St** (Lower East Side), with walk times, transit tips and a "Directions from 303 Broome" link. The UI follows the *sticker-bloom* direction in `Petal Health NYC.html`.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

With no `DATABASE_URL`, the app uses **embedded PostgreSQL** (PGlite, stored in `./.pglite`) and seeds itself on first start.

### Against a real Postgres

`npm start`, `npm run dev` and `npm run db:setup` read a `.env` file if one exists. To use a local Postgres, put the connection string there, for example `DATABASE_URL=postgres://postgres@localhost:5432/petalclub`. With no password in the URL, the password comes from `%APPDATA%\postgresql\pgpass.conf`.

```bash
docker compose up --build                  # Postgres 16 + the app on :3000
# or point at any Postgres 14+:
DATABASE_URL=postgres://user:pass@host:5432/db npm run db:setup   # drops & reloads tables
DATABASE_URL=postgres://user:pass@host:5432/db npm start
```

## How it's built

| Path | What |
|---|---|
| `db/schema.sql` | Tables (`home_base`, `categories`, `listings`, `submissions`), a `miles_between()` haversine function, and `listing_view`, which adds distance, walk minutes and a full-text search document |
| `db/seed.sql` | About 60 real places and programs near 303 Broome St |
| `src/server.js` | Express API and static file server |
| `src/db.js` | `pg` pool when `DATABASE_URL` is set; PGlite otherwise |
| `public/` | Single-page front end (vanilla JS, Leaflet + OpenStreetMap) |

### API

- `GET /api/meta`: home base, categories with counts, totals
- `GET /api/listings?category=&q=&tags=a,b&walkable=1&free=1&sort=distance|saves|name`
- `GET /api/listings/:slug`
- `POST /api/listings/:slug/save` with `{ "saved": true|false }`: updates the save count
- `POST /api/submissions` with `{ name, category, address, website, why, submitter }`: queues a suggestion as `pending`

Yoga and Pilates are part of **Workouts**. Their subcategories are Yoga, Hot yoga, Donation-based yoga, Free outdoor yoga and Pilates, and they carry `yoga`/`pilates` tags, so the "Yoga classes" and "Pilates classes" filters also catch gyms like the YMCAs. Old `#/c/yoga` and `#/c/pilates` links redirect to Workouts with that filter on.

### Adding or changing listings

Edit `db/seed.sql` and run `npm run db:setup`, or insert into `listings` directly.

For a batch of new listings, put them in a JSON file (same fields as the `listings` table plus `category` and `source_url`) and run:

```bash
node scripts/import-listings.js new.sql new.json
psql -d petalclub -f new.sql        # inserts are idempotent (ON CONFLICT DO NOTHING)
```

The importer drops rows with bad tags, slugs or coordinates, and rows more than ~45 min by train from 303 Broome.

Distances are estimates computed in `listing_view`:
- **Walk:** straight-line miles × 1.25 (for the street grid) × 20 min/mile.
- **Train:** 10 min (walking and waiting) + 5 min per straight-line mile, + 10 min for the PATH transfer to New Jersey.
- **Borough:** derived from the address (Manhattan, Brooklyn, Queens, New Jersey, or Citywide / online).

To review suggestions:

```sql
SELECT * FROM submissions WHERE status = 'pending' ORDER BY created_at;
```

## Data note

The seed data covers real clinics, hotlines, studios and organizations. It names no individual doctors and has no made-up ratings or reviews. Hours, prices, eligibility and phone numbers change, so verify them before you rely on them. Every listing in the app shows that reminder.
