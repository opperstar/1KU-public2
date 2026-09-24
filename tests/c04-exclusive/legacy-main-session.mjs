import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const [libraryRoot] = process.argv.slice(2);
if (!libraryRoot) throw new Error('usage: legacy-main-session.mjs <libraryRoot>');

await fs.mkdir(libraryRoot, { recursive: true });
const mainPath = path.join(libraryRoot, 'main.sqlite');
const db = new DatabaseSync(mainPath);
db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
db.exec('CREATE TABLE IF NOT EXISTS legacy_proof(event TEXT NOT NULL, at INTEGER NOT NULL);');
db.prepare('INSERT INTO legacy_proof(event, at) VALUES(?, ?)').run('LEGACY_923_OPEN', Date.now());
process.stdout.write(JSON.stringify({ event: 'LEGACY_OPEN', mainPath }) + '\n');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (line.trim() === 'RELEASE') {
    try { db.close(); } finally {
      process.stdout.write(JSON.stringify({ event: 'LEGACY_RELEASED' }) + '\n');
      process.exit(0);
    }
  }
});
