import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'crs.sqlite');
console.log('Opening DB at', dbPath);
const db = new Database(dbPath);
try {
  const row = db.prepare("SELECT key, value FROM settings WHERE key = 'teams_state'").get();
  console.log('Before:', !!row, row && row.value ? `(len ${row.value.length}) ` + row.value.substring(0,500) : row && row.value);
  const info = db.prepare("UPDATE settings SET value = '' WHERE key = 'teams_state'").run();
  console.log('Update info:', info);
  const row2 = db.prepare("SELECT key, value FROM settings WHERE key = 'teams_state'").get();
  console.log('After:', !!row2, row2 && row2.value ? `(len ${row2.value.length}) ` + row2.value.substring(0,500) : row2 && row2.value);
  console.log('\n-- All settings rows --');
  const all = db.prepare('SELECT key, length(value) as vlen, value FROM settings').all();
  all.forEach(r => console.log(r.key, r.vlen));
} catch (e) {
  console.error('Error:', e.message || e);
} finally {
  db.close();
}
