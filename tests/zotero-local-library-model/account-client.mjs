import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [localRoot, libraryId, holdMsRaw, outPath] = process.argv.slice(2);
if (!localRoot || !libraryId || !outPath) {
  throw new Error('usage: account-client.mjs <localRoot> <libraryId> <holdMs> <outPath>');
}
const holdMs = Number(holdMsRaw || '0');
await fs.mkdir(localRoot, { recursive: true });

const mainPath = path.join(localRoot, 'main.sqlite');
const coordRoot = path.join(localRoot, 'coord');
await fs.mkdir(coordRoot, { recursive: true });

{
  const db = new DatabaseSync(mainPath);
  db.exec('CREATE TABLE IF NOT EXISTS library_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
  db.prepare('INSERT INTO library_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('library_id', libraryId);
  db.close();
}

let mainIdentity = path.resolve(mainPath);
if (process.platform === 'win32') mainIdentity = mainIdentity.toLowerCase();
const gateKey = crypto.createHash('sha256').update(mainIdentity, 'utf8').digest('hex');
const gatePath = path.join(coordRoot, gateKey + '.sqlite');
const gate = new DatabaseSync(gatePath);
gate.exec('PRAGMA busy_timeout=250; BEGIN EXCLUSIVE;');
gate.prepare('PRAGMA schema_version').get();

const main = new DatabaseSync(mainPath, { readOnly: true });
const storedLibraryId = main.prepare("SELECT value FROM library_meta WHERE key='library_id'").get()?.value;
main.close();
if (storedLibraryId !== libraryId) throw new Error('LIBRARY_ID_MISMATCH');

const evidence = {
  result: 'ACQUIRED',
  platform: process.platform,
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
  pid: process.pid,
  libraryId,
  localRoot,
  mainPath,
  gatePath,
};
await fs.writeFile(outPath, JSON.stringify(evidence, null, 2));

if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
try { gate.exec('ROLLBACK'); } finally { gate.close(); }
