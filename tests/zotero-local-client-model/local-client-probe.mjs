import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [clientRoot, libraryId, holdMsRaw = '0', outPath] = process.argv.slice(2);
if (!clientRoot || !libraryId || !outPath) throw new Error('usage: local-client-probe.mjs <clientRoot> <libraryId> <holdMs> <outPath>');
const holdMs = Number(holdMsRaw);

function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' &&
    /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}
await fs.mkdir(clientRoot, { recursive: true });
const mainPath = path.join(clientRoot, 'main.sqlite');
let main = new DatabaseSync(mainPath);
main.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS business(id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
main.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('library_id', libraryId);
main.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('schema_version', '4');
main.close();

const sessionDir = path.join(clientRoot, 'session');
await fs.mkdir(sessionDir, { recursive: true });
const key = crypto.createHash('sha256').update(String(libraryId)).digest('hex');
const gatePath = path.join(sessionDir, key + '.sqlite');
const gate = new DatabaseSync(gatePath);
const started = performance.now();
let result;
try {
  gate.exec('PRAGMA busy_timeout=250; BEGIN EXCLUSIVE;');
  gate.prepare('PRAGMA schema_version').get();
  main = new DatabaseSync(mainPath);
  main.prepare('INSERT INTO business(value) VALUES(?)').run('pid-' + process.pid);
  main.close();
  result = {
    result: 'ACQUIRED',
    elapsedMs: performance.now() - started,
    platform: process.platform,
    pid: process.pid,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    libraryId,
    mainPath,
    gatePath,
  };
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  if (holdMs > 0) await new Promise(r => setTimeout(r, holdMs));
  gate.exec('ROLLBACK');
  gate.close();
} catch (error) {
  const elapsedMs = performance.now() - started;
  try { gate.close(); } catch {}
  if (isBusy(error)) {
    result = {
      result: 'DENIED',
      elapsedMs,
      platform: process.platform,
      pid: process.pid,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      libraryId,
      mainPath,
      gatePath,
    };
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  } else {
    result = { result: 'ERROR', message: error?.message, code: error?.code, platform: process.platform };
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}
