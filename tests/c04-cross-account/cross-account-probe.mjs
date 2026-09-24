import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [coordRoot, libraryId, holdMsRaw = '0', outPath] = process.argv.slice(2);
if (!coordRoot || !libraryId || !outPath) throw new Error('usage: cross-account-probe.mjs <coordRoot> <libraryId> <holdMs> <outPath>');

const holdMs = Number(holdMsRaw);
const BUSY_MS = 250;

function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' &&
    /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}

const oldUmask = process.umask(0);
try {
  await fs.mkdir(coordRoot, { recursive: true, mode: 0o777 });
} finally {
  process.umask(oldUmask);
}
try { await fs.chmod(coordRoot, 0o777); } catch {}

const key = createHash('sha256').update(String(libraryId)).digest('hex');
const gatePath = path.join(coordRoot, key + '.sqlite');
const beforeUmask = process.umask(0);
let db;
try {
  db = new DatabaseSync(gatePath);
} finally {
  process.umask(beforeUmask);
}
try { await fs.chmod(gatePath, 0o666); } catch {}

const started = performance.now();
let result;
try {
  db.exec(`PRAGMA busy_timeout=${BUSY_MS}; BEGIN EXCLUSIVE;`);
  db.prepare('PRAGMA schema_version').get();
  result = {
    result: 'ACQUIRED',
    elapsedMs: performance.now() - started,
    platform: process.platform,
    pid: process.pid,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    gatePath,
  };
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
  db.exec('ROLLBACK');
  db.close();
} catch (error) {
  const elapsedMs = performance.now() - started;
  try { db.close(); } catch {}
  if (isBusy(error)) {
    result = {
      result: 'DENIED',
      elapsedMs,
      platform: process.platform,
      pid: process.pid,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gatePath,
    };
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  } else {
    result = { result: 'ERROR', message: error?.message, code: error?.code, platform: process.platform };
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }
}
