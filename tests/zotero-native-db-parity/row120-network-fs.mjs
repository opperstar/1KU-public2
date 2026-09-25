import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootEnv = process.env.ROW120_NETWORK_FS_ROOT;
if (!rootEnv) throw new Error('ROW120_NETWORK_FS_ROOT is required');

const networkRoot = path.resolve(rootEnv);
const runRoot = path.join(networkRoot, '1ku-row120-' + process.pid);
const artifactDir = path.resolve('artifacts');
await fs.mkdir(runRoot, { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'Qualify Zotero row120 node:sqlite translation on a real macOS network filesystem',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  networkRoot,
  startedAt: new Date().toISOString(),
};

function scalar(row) {
  if (!row) return undefined;
  return Object.values(row)[0];
}

function pragmaScalar(db, sql) {
  return scalar(db.prepare(sql).get());
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

let db;
try {
  const statfs = await fs.statfs(networkRoot);
  evidence.statfs = {
    type: Number(statfs.type),
    bsize: Number(statfs.bsize),
  };

  const dbPath = path.join(runRoot, 'main.sqlite');
  db = new DatabaseSync(dbPath);

  // Target translation under qualification:
  // Node opens the file with its native DatabaseSync behavior, then 1KU establishes
  // SQLite connection-lifetime EXCLUSIVE before the first WAL access.
  const lockingMode = String(pragmaScalar(db, 'PRAGMA main.locking_mode=EXCLUSIVE')).toLowerCase();
  const journalMode = String(pragmaScalar(db, 'PRAGMA journal_mode=WAL')).toLowerCase();
  db.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  const insert = db.prepare('INSERT INTO t(v) VALUES (?)');
  for (let i = 0; i < 100; i++) insert.run('row-' + i + '-' + 'x'.repeat(128));

  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const walBytes = (await fs.stat(walPath)).size;
  const shmExistsWhileOpen = await exists(shmPath);

  let contender = null;
  let contenderBlocked = false;
  let contenderError = null;
  try {
    contender = new DatabaseSync(dbPath);
    contender.exec('PRAGMA busy_timeout=0');
    contender.exec("INSERT INTO t(v) VALUES ('contender')");
  } catch (error) {
    contenderBlocked = true;
    contenderError = {
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    };
  } finally {
    try { contender?.close(); } catch {}
  }

  const ownerCountBeforeClose = Number(pragmaScalar(db, 'SELECT COUNT(*) FROM t'));
  db.close();
  db = null;

  const reopened = new DatabaseSync(dbPath, { readOnly: true });
  const countAfterReopen = Number(pragmaScalar(reopened, 'SELECT COUNT(*) FROM t'));
  const integrity = String(pragmaScalar(reopened, 'PRAGMA integrity_check(1)'));
  reopened.close();

  assert(lockingMode === 'exclusive', 'locking_mode=EXCLUSIVE was not established before WAL', { lockingMode });
  assert(journalMode === 'wal', 'WAL could not be established after EXCLUSIVE on the network filesystem', { journalMode });
  assert(walBytes > 0, 'WAL was not active', { walBytes });
  assert(!shmExistsWhileOpen, 'EXCLUSIVE-before-WAL still created a -shm file', { shmExistsWhileOpen });
  assert(contenderBlocked, 'competing writer was not blocked while owner held EXCLUSIVE', { contenderError });
  assert(ownerCountBeforeClose === 100, 'owner row count changed before close', { ownerCountBeforeClose });
  assert(countAfterReopen === 100 && integrity === 'ok', 'close/reopen/integrity failed', { countAfterReopen, integrity });

  evidence.result = 'PASS';
  evidence.details = {
    lockingMode,
    journalMode,
    walBytes,
    shmExistsWhileOpen,
    contenderBlocked,
    contenderError,
    ownerCountBeforeClose,
    countAfterReopen,
    integrity,
  };
} catch (error) {
  evidence.result = 'FAIL';
  evidence.error = {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    details: error?.details ?? null,
    stack: error?.stack ?? null,
  };
  process.exitCode = 1;
} finally {
  try { db?.close(); } catch {}
  try {
    await fs.rm(runRoot, { recursive: true, force: true });
    evidence.cleanup = 'PASS';
  } catch (error) {
    evidence.cleanup = 'FAIL: ' + error.message;
    process.exitCode = 1;
  }
}

evidence.finishedAt = new Date().toISOString();
const artifact = path.join(artifactDir, `row120-network-fs-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ result: evidence.result, artifact, details: evidence.details, error: evidence.error }, null, 2));
