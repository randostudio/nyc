// Drops and recreates all tables, then loads db/seed.sql.
import { getDb, resetDatabase, query } from '../src/db.js';

const db = await getDb();
await resetDatabase();
const [{ count }] = await query('SELECT count(*)::int AS count FROM listings');
console.log(`Loaded ${count} listings into ${db.label}.`);
process.exit(0);
