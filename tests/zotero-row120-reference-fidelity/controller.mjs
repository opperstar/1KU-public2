import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-row120-reference-fidelity-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'Qualify Zotero row120 reference semantics and the node:sqlite equivalent landing without claiming a real network filesystem mount',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  startedAt: new Date().toISOString(),
  scenarios: {},
};

function assert(condition, message, details = null) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

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
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

function isBusy(error) {
  const msg = error?.message ?? String(error);
  return error?.errcode === 5 || error?.errcode === 6 || /busy|locked/i.test(msg);
}

function contenderMain(dbPath) {
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { timeout: 0 });
    db.exec('PRAGMA busy_timeout=0');
    db.exec("INSERT INTO probe(value) VALUES ('contender')");
    console.log(JSON.stringify({ result: 'WRITE_SUCCEEDED' }));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      result: isBusy(error) ? 'BLOCKED_BUSY' : 'ERROR',
      code: error?.code ?? null,
      errcode: error?.errcode ?? null,
      message: error?.message ?? String(error),
    }));
    return isBusy(error) ? 10 : 20;
  } finally {
    try { db?.close(); } catch {}
  }
}

function runContender(dbPath) {
  const r = spawnSync(process.execPath, [SELF, '--contender', dbPath], {
    encoding: 'utf8',
    timeout: 5000,
  });
  let payload = null;
  try { payload = JSON.parse(String(r.stdout || '').trim()); } catch {}
  const deniedWhileHeld =
    (r.status === 10 && payload?.result === 'BLOCKED_BUSY')
    || (r.status === null && r.signal === 'SIGTERM' && r.error?.code === 'ETIMEDOUT');
  return {
    status: r.status,
    signal: r.signal,
    error: r.error ? { code: r.error.code, message: r.error.message } : null,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim(),
    payload,
    deniedWhileHeld,
  };
}

// Exact source predicate from Zotero.DBConnection.prototype._canUseWAL().
function zoteroCanUseWAL({ platform, info, byteRangeLocks }) {
  if (platform !== 'darwin') return true;
  if (!info) return false;
  if (['afpfs', 'smbfs', 'webdav', 'nfs'].includes(info.fsType) || info.readOnly) {
    return false;
  }
  return !!byteRangeLocks;
}

// Exact source branch from Zotero.DBConnection.prototype.backUpDatabase().
function zoteroBackupOnlineAfterFilesystemPolicy({ platform, requestedOnline, fsType }) {
  if (requestedOnline && platform === 'linux' && ['cifs', 'smb', 'smb2', 'nfs'].includes(fsType)) {
    return false;
  }
  return requestedOnline;
}

async function runScenario(name, fn) {
  try {
    const details = await fn();
    evidence.scenarios[name] = { result: 'PASS', ...(details ?? {}) };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      error: { message: error?.message, details: error?.details, stack: error?.stack },
    };
  }
}

if (process.argv[2] === '--contender') {
  process.exitCode = contenderMain(process.argv[3]);
}
else {

await runScenario('row120_exact_zotero_can_use_wal_decision_table', async () => {
  const cases = [
    ['mac-null-info', { platform: 'darwin', info: null, byteRangeLocks: true }, false],
    ['mac-afp', { platform: 'darwin', info: { fsType: 'afpfs', readOnly: false }, byteRangeLocks: true }, false],
    ['mac-smb', { platform: 'darwin', info: { fsType: 'smbfs', readOnly: false }, byteRangeLocks: true }, false],
    ['mac-webdav', { platform: 'darwin', info: { fsType: 'webdav', readOnly: false }, byteRangeLocks: true }, false],
    ['mac-nfs', { platform: 'darwin', info: { fsType: 'nfs', readOnly: false }, byteRangeLocks: true }, false],
    ['mac-readonly', { platform: 'darwin', info: { fsType: 'apfs', readOnly: true }, byteRangeLocks: true }, false],
    ['mac-byte-locks-missing', { platform: 'darwin', info: { fsType: 'apfs', readOnly: false }, byteRangeLocks: false }, false],
    ['mac-apfs-locks', { platform: 'darwin', info: { fsType: 'apfs', readOnly: false }, byteRangeLocks: true }, true],
    ['linux-nfs', { platform: 'linux', info: { fsType: 'nfs', readOnly: false }, byteRangeLocks: false }, true],
    ['win', { platform: 'win32', info: null, byteRangeLocks: false }, true],
  ];
  for (const [name, input, expected] of cases) {
    const actual = zoteroCanUseWAL(input);
    assert(actual === expected, 'Zotero _canUseWAL decision-table mismatch', { name, input, expected, actual });
  }
  return { cases: cases.length };
});

await runScenario('row120_exact_linux_network_backup_branch', async () => {
  const network = ['cifs', 'smb', 'smb2', 'nfs'];
  for (const fsType of network) {
    assert(zoteroBackupOnlineAfterFilesystemPolicy({ platform: 'linux', requestedOnline: true, fsType }) === false,
      'Linux network filesystem did not force offline backup', { fsType });
  }
  assert(zoteroBackupOnlineAfterFilesystemPolicy({ platform: 'linux', requestedOnline: true, fsType: 'ext4' }) === true,
    'Linux local filesystem unexpectedly disabled online backup');
  assert(zoteroBackupOnlineAfterFilesystemPolicy({ platform: 'darwin', requestedOnline: true, fsType: 'nfs' }) === true,
    'macOS branch incorrectly reused Linux backup rule');
  return { network };
});

await runScenario('row120_use_wal_true_equivalent_landing', async () => {
  const p = path.join(root, 'wal-true.sqlite');
  let db = new DatabaseSync(p, { timeout: 0 });
  db.exec('PRAGMA busy_timeout=0');
  const locking = String(pragmaScalar(db, 'PRAGMA main.locking_mode=EXCLUSIVE')).toLowerCase();
  const journal = String(pragmaScalar(db, 'PRAGMA journal_mode=WAL')).toLowerCase();
  db.exec('PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO probe(value) VALUES (?)');
  for (let i = 0; i < 100; i++) ins.run('owner-' + i + '-' + 'x'.repeat(128));
  const walBytes = (await fs.stat(p + '-wal')).size;
  const shmExists = await exists(p + '-shm');
  const contenderHeld = runContender(p);
  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const walAfter = (await fs.stat(p + '-wal')).size;
  db.close();
  db = null;

  const contenderReleased = runContender(p);
  const reopened = new DatabaseSync(p, { readOnly: true });
  const rows = Number(pragmaScalar(reopened, 'SELECT COUNT(*) FROM probe'));
  const integrity = String(pragmaScalar(reopened, 'PRAGMA integrity_check(1)'));
  reopened.close();

  assert(locking === 'exclusive', 'EXCLUSIVE was not established before WAL', { locking });
  assert(journal === 'wal', 'WAL was not established', { journal });
  assert(walBytes > 0, 'WAL did not contain real data', { walBytes });
  assert(!shmExists, 'EXCLUSIVE-before-WAL created -shm', { shmExists });
  assert(contenderHeld.deniedWhileHeld,
    'second writer crossed owner EXCLUSIVE protection', contenderHeld);
  assert(walAfter === 0, 'checkpoint did not truncate WAL', { checkpoint, walAfter });
  assert(contenderReleased.status === 0 && contenderReleased.payload?.result === 'WRITE_SUCCEEDED',
    'second writer did not succeed after owner release', contenderReleased);
  assert(rows === 101 && integrity === 'ok', 'reopen/integrity failed', { rows, integrity });

  return { locking, journal, walBytes, shmExists, contenderHeld, checkpoint, walAfter, contenderReleased, rows, integrity };
});

await runScenario('row120_use_wal_false_preopen_downgrade_nonempty_wal', async () => {
  const source = path.join(root, 'rollback-source.sqlite');
  const target = path.join(root, 'rollback-target.sqlite');
  const temp = path.join(root, 'rollback-convert.sqlite');

  const live = new DatabaseSync(source);
  live.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  live.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const ins = live.prepare('INSERT INTO probe(value) VALUES (?)');
  for (let i = 0; i < 60; i++) ins.run('wal-row-' + i + '-' + 'x'.repeat(64));
  const sourceWalBytes = (await fs.stat(source + '-wal')).size;
  assert(sourceWalBytes > 0, 'source WAL was empty before snapshot', { sourceWalBytes });

  await fs.copyFile(source, target);
  await fs.copyFile(source + '-wal', target + '-wal');
  live.close();

  // Zotero semantics: never mutate the original Main until a converted replacement validates.
  await fs.copyFile(target, temp);
  await fs.copyFile(target + '-wal', temp + '-wal');
  let conversion = new DatabaseSync(temp);
  const beforeMode = String(pragmaScalar(conversion, 'PRAGMA journal_mode')).toLowerCase();
  const deleteMode = String(pragmaScalar(conversion, 'PRAGMA journal_mode=DELETE')).toLowerCase();
  conversion.close();

  const validated = new DatabaseSync(temp, { readOnly: true });
  const convertedRows = Number(pragmaScalar(validated, 'SELECT COUNT(*) FROM probe'));
  const convertedIntegrity = String(pragmaScalar(validated, 'PRAGMA integrity_check(1)'));
  validated.close();
  assert(beforeMode === 'wal' && deleteMode === 'delete', 'temp replacement did not replay WAL and convert to rollback', { beforeMode, deleteMode });
  assert(convertedRows === 60 && convertedIntegrity === 'ok', 'converted replacement failed validation', { convertedRows, convertedIntegrity });

  // Publish only the validated replacement; discard the old WAL sidecar.
  await fs.rm(target, { force: true });
  await fs.rm(target + '-wal', { force: true });
  await fs.rm(target + '-shm', { force: true });
  await fs.rename(temp, target);
  await fs.rm(temp + '-wal', { force: true });
  await fs.rm(temp + '-shm', { force: true });

  let db = new DatabaseSync(target, { timeout: 0 });
  db.exec('PRAGMA busy_timeout=0');
  const locking = String(pragmaScalar(db, 'PRAGMA main.locking_mode=EXCLUSIVE')).toLowerCase();
  const finalJournal = String(pragmaScalar(db, 'PRAGMA journal_mode')).toLowerCase();
  const contenderHeld = runContender(target);
  const rows = Number(pragmaScalar(db, 'SELECT COUNT(*) FROM probe'));
  const integrity = String(pragmaScalar(db, 'PRAGMA integrity_check(1)'));
  db.close();
  db = null;

  assert(locking === 'exclusive', 'rollback branch did not establish EXCLUSIVE', { locking });
  assert(finalJournal !== 'wal', 'rollback branch reopened in WAL mode', { finalJournal });
  assert(contenderHeld.deniedWhileHeld,
    'rollback branch allowed a second writer through owner EXCLUSIVE protection', contenderHeld);
  assert(rows === 60 && integrity === 'ok', 'rollback branch lost WAL data or failed integrity', { rows, integrity });

  return { sourceWalBytes, beforeMode, deleteMode, convertedRows, convertedIntegrity, locking, finalJournal, contenderHeld, rows, integrity };
});

const failures = Object.entries(evidence.scenarios).filter(([, x]) => x.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.realNetworkFilesystemObserved = false;
evidence.hostResidual = 'Real macOS SMB/NFS/WebDAV/AFP filesystem fact observation and literal Gecko openNotExclusive behavior remain HOST_PENDING; this fixture proves source decision semantics plus node:sqlite equivalent branches only.';
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `zotero-row120-reference-fidelity-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
await fs.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({
  result: evidence.result,
  failedScenarios: evidence.failedScenarios,
  artifact,
  hostResidual: evidence.hostResidual,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
}
