// Database access. Uses a real PostgreSQL server when DATABASE_URL is set,
// otherwise an embedded Postgres (PGlite) stored in ./.pglite so the app runs
// with zero setup. Both speak the same SQL and $1-style parameters.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let backend;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    return {
      label: 'PostgreSQL (DATABASE_URL)',
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(path.join(root, '.pglite'));
  await db.waitReady;
  return {
    label: 'embedded PostgreSQL (PGlite, ./.pglite)',
    query: (text, params) => db.query(text, params),
    exec: (sql) => db.exec(sql),
  };
}

export async function getDb() {
  backend ??= await connect();
  return backend;
}

export async function query(text, params = []) {
  const db = await getDb();
  const { rows } = await db.query(text, params);
  return rows;
}

// Creates the schema and loads seed data. Destructive: drops existing tables.
export async function resetDatabase() {
  const db = await getDb();
  for (const file of ['schema.sql', 'seed.sql']) {
    await db.exec(await readFile(path.join(root, 'db', file), 'utf8'));
  }
}

export async function isInitialized() {
  const rows = await query(`SELECT to_regclass('public.listings') IS NOT NULL AS ok`);
  return rows[0].ok;
}
