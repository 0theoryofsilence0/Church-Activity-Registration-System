import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// Use working directory to locate crs.sqlite when running from backend/
const dbPath = path.join(process.cwd(), 'crs.sqlite');

function backupDb(src) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = src + `.bak-${timestamp}`;
  fs.copyFileSync(src, dest);
  return dest;
}

try {
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found at', dbPath);
    process.exit(1);
  }
  const bak = backupDb(dbPath);
  console.log('Backup created:', bak);

  const db = new Database(dbPath);
  // Check current teams_state
  const row = db.prepare("SELECT value FROM settings WHERE key = 'teams_state'").get();
  console.log('Current teams_state exists:', !!row);
  if (row) {
    // Show truncated preview
    console.log('Preview (first 200 chars):', row.value ? row.value.substring(0,200) : '<empty>');
    // Clear it
    db.prepare("UPDATE settings SET value = '' WHERE key = 'teams_state'").run();
    console.log('teams_state cleared (value set to empty string)');
  } else {
    console.log("No teams_state row found in settings. Nothing to clear.");
  }

  db.close();
  process.exit(0);
} catch (e) {
  console.error('Error while clearing teams_state:', e.message || e);
  process.exit(2);
}
