-- Petal Health NYC schema (PostgreSQL 14+)

DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS listings CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS home_base CASCADE;

-- The point every distance is measured from.
CREATE TABLE home_base (
  id        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  label     text NOT NULL,
  address   text NOT NULL,
  lat       double precision NOT NULL,
  lng       double precision NOT NULL
);

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  blurb       text NOT NULL,
  badge       text,
  color       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE listings (
  id           serial PRIMARY KEY,
  slug         text UNIQUE NOT NULL,
  category_id  int NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL,              -- subcategory, e.g. "OBGYN & sexual health"
  description  text NOT NULL,
  address      text,                       -- NULL for phone / online resources
  neighborhood text NOT NULL,
  lat          double precision,
  lng          double precision,
  transit      text,                       -- how to get there from 303 Broome
  phone        text,
  website      text,
  cost         text,
  tags         text[] NOT NULL DEFAULT '{}',
  is_free      boolean NOT NULL DEFAULT false,
  source_url   text,                       -- where the listing was last verified
  saves        int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listings_category_idx ON listings (category_id);
CREATE INDEX listings_tags_idx ON listings USING gin (tags);

-- "Know a gem? Spill." — community suggestions awaiting review.
CREATE TABLE submissions (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  category_slug text,
  address       text,
  website       text,
  why           text,
  submitter     text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Great-circle distance in miles.
CREATE OR REPLACE FUNCTION miles_between(lat1 double precision, lng1 double precision,
                                         lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 3958.8 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Listings enriched with distance / walk time from home base and a search document.
CREATE OR REPLACE VIEW listing_view AS
SELECT
  l.*,
  c.slug  AS category_slug,
  c.name  AS category_name,
  c.color AS category_color,
  CASE WHEN l.lat IS NULL THEN NULL
       ELSE round(miles_between(h.lat, h.lng, l.lat, l.lng)::numeric, 2) END AS miles,
  -- Manhattan grid detour (~1.25x straight line) at ~20 min per mile.
  CASE WHEN l.lat IS NULL THEN NULL
       ELSE ceil(miles_between(h.lat, h.lng, l.lat, l.lng) * 1.25 * 20)::int END AS walk_minutes,
  -- Door-to-door subway estimate: ~10 min walking/waiting + ~5 min per straight-line mile,
  -- plus ~10 min for the subway→PATH transfer when the place is in New Jersey.
  CASE WHEN l.lat IS NULL THEN NULL
       ELSE ceil(10 + miles_between(h.lat, h.lng, l.lat, l.lng) * 5
                 + CASE WHEN l.address ~* ',\s*NJ\M' THEN 10 ELSE 0 END)::int END AS train_minutes,
  CASE WHEN l.address IS NULL THEN 'Citywide / online'
       WHEN l.address ~* ',\s*NJ\M' THEN 'New Jersey'
       WHEN l.address ~* 'Brooklyn, NY' THEN 'Brooklyn'
       WHEN l.address ~* '(Queens|Long Island City|Astoria|Sunnyside|Woodside|Jackson Heights|Elmhurst|Flushing|Ridgewood|, NY 11[13-6]\d\d)' THEN 'Queens'
       WHEN l.address ~* 'Bronx' THEN 'Bronx'
       ELSE 'Manhattan' END AS borough,
  to_tsvector('english',
    l.name || ' ' || l.kind || ' ' || l.description || ' ' || l.neighborhood || ' ' ||
    c.name || ' ' || coalesce(l.cost, '') || ' ' || array_to_string(l.tags, ' ')) AS document
FROM listings l
JOIN categories c ON c.id = l.category_id
CROSS JOIN home_base h;
