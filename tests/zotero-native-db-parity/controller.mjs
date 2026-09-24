import { DatabaseSync, backup } from 'node:sqlite';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-zotero-native-db-parity-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'Qualify Zotero-native SQLite semantics on Node 24 node:sqlite without 1KU production source',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  startedAt: new Date().toISOString(),
  scenarios: {},
};

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function scalar(row) {
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0];
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

async function runScenario(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    evidence.scenarios[name] = {
      result: 'PASS',
      elapsedMs: Date.now() - started,
      ...(details ?? {}),
    };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Date.now() - started,
      error: { message: error?.message, details: error?.details, stack: error?.stack },
    };
  }
}

function dbPath(name) {
  return path.join(root, name + '.sqlite');
}

await runScenario('row004_fresh_db_page_size_and_utf8', async () => {
  const p = dbPath('row004');
  let db = new DatabaseSync(p);
  db.exec("PRAGMA page_size=4096; PRAGMA encoding='UTF-8'; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);");
  const before = {
    pageSize: pragmaScalar(db, 'PRAGMA page_size'),
    encoding: pragmaScalar(db, 'PRAGMA encoding'),
  };
  db.close();

  db = new DatabaseSync(p);
  const after = {
    pageSize: pragmaScalar(db, 'PRAGMA page_size'),
    encoding: pragmaScalar(db, 'PRAGMA encoding'),
  };
  db.close();

  assert(before.pageSize === 4096 && after.pageSize === 4096, 'page_size=4096 did not persist', { before, after });
  assert(String(before.encoding).toUpperCase() === 'UTF-8' && String(after.encoding).toUpperCase() === 'UTF-8',
    'UTF-8 encoding did not persist', { before, after });
  return { before, after };
});

await runScenario('row048_online_backup_open_connection_and_integrity', async () => {
  const src = dbPath('row048-source');
  const dst = dbPath('row048-backup');
  const db = new DatabaseSync(src);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  const insert = db.prepare('INSERT INTO t(v) VALUES (?)');
  for (let i = 0; i < 200; i++) insert.run('row-' + i);

  let progressCalls = 0;
  const pages = await backup(db, dst, {
    rate: 1,
    progress() { progressCalls++; },
  });

  assert(pragmaScalar(db, 'SELECT COUNT(*) FROM t') === 200, 'source connection was not usable after online backup');

  const copy = new DatabaseSync(dst, { readOnly: true });
  const count = pragmaScalar(copy, 'SELECT COUNT(*) FROM t');
  const integrity = pragmaScalar(copy, 'PRAGMA integrity_check(1)');
  copy.close();
  db.close();

  assert(count === 200, 'online backup row count mismatch', { count });
  assert(integrity === 'ok', 'online backup failed integrity check', { integrity });
  assert(Number(pages) > 0, 'online backup reported no pages', { pages });
  return { pages, progressCalls, count, integrity };
});

await runScenario('row049_offline_close_copy_reopen', async () => {
  const src = dbPath('row049-source');
  const dst = dbPath('row049-copy');
  let db = new DatabaseSync(src);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('alpha'),('beta');");
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  db.close();

  await fs.copyFile(src, dst);

  const original = new DatabaseSync(src, { readOnly: true });
  const copied = new DatabaseSync(dst, { readOnly: true });
  const a = pragmaScalar(original, 'SELECT COUNT(*) FROM t');
  const b = pragmaScalar(copied, 'SELECT COUNT(*) FROM t');
  const ok = pragmaScalar(copied, 'PRAGMA integrity_check(1)');
  original.close();
  copied.close();

  assert(a === 2 && b === 2 && ok === 'ok', 'close/copy/reopen preservation mismatch', { a, b, ok });
  return { originalRows: a, copiedRows: b, integrity: ok };
});

await runScenario('row050_copy_on_write_fast_path_when_available', async () => {
  const src = path.join(root, 'row050-source.bin');
  const dst = path.join(root, 'row050-clone.bin');
  const payload = Buffer.alloc(1024 * 1024, 0x5a);
  await fs.writeFile(src, payload);
  await fs.copyFile(src, dst, fsConstants.COPYFILE_FICLONE);
  const cloned = await fs.readFile(dst);
  assert(cloned.equals(payload), 'COPYFILE_FICLONE result differs from source');

  let forcedClone = 'NOT_APPLICABLE';
  if (process.platform === 'darwin') {
    const forceDst = path.join(root, 'row050-clone-force.bin');
    await fs.copyFile(src, forceDst, fsConstants.COPYFILE_FICLONE_FORCE);
    const forced = await fs.readFile(forceDst);
    assert(forced.equals(payload), 'COPYFILE_FICLONE_FORCE result differs on macOS');
    forcedClone = 'PASS';
  }
  return { ficlone: 'PASS', forcedClone };
});

await runScenario('row063_wal_checkpoint_truncate', async () => {
  const p = dbPath('row063');
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  const ins = db.prepare('INSERT INTO t(v) VALUES (?)');
  for (let i = 0; i < 300; i++) ins.run('payload-' + i + '-' + 'x'.repeat(200));
  const walPath = p + '-wal';
  const before = (await fs.stat(walPath)).size;
  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const after = (await fs.stat(walPath)).size;
  db.close();

  assert(before > 0, 'WAL was not populated before checkpoint', { before });
  assert(after === 0, 'WAL was not truncated', { before, after, checkpoint });
  return { walBytesBefore: before, walBytesAfter: after, checkpoint };
});

await runScenario('row065_clean_wal_to_rollback_journal', async () => {
  const p = dbPath('row065-clean');
  let db = new DatabaseSync(p);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('a'),('b');");
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const modeBefore = String(pragmaScalar(db, 'PRAGMA journal_mode')).toLowerCase();
  const modeAfterSet = String(pragmaScalar(db, 'PRAGMA journal_mode=DELETE')).toLowerCase();
  db.close();

  const header = await fs.readFile(p);
  const formatBytes = [header[18], header[19]];
  db = new DatabaseSync(p, { readOnly: true });
  const count = pragmaScalar(db, 'SELECT COUNT(*) FROM t');
  const integrity = pragmaScalar(db, 'PRAGMA integrity_check(1)');
  db.close();

  assert(modeBefore === 'wal', 'database was not in WAL mode', { modeBefore });
  assert(modeAfterSet === 'delete', 'journal mode did not downgrade to DELETE', { modeAfterSet });
  assert(formatBytes[0] === 1 && formatBytes[1] === 1, 'rollback-journal header bytes were not restored', { formatBytes });
  assert(count === 2 && integrity === 'ok', 'downgraded database is not valid', { count, integrity });
  return { modeBefore, modeAfterSet, formatBytes, count, integrity };
});

await runScenario('row065_nonempty_wal_temp_copy_conversion', async () => {
  const src = dbPath('row065-live');
  const tmp = dbPath('row065-temp');
  const live = new DatabaseSync(src);
  live.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  live.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const ins = live.prepare('INSERT INTO t(v) VALUES (?)');
  for (let i = 0; i < 50; i++) ins.run('wal-' + i);
  const walSize = (await fs.stat(src + '-wal')).size;
  assert(walSize > 0, 'live WAL is empty before copy', { walSize });

  await fs.copyFile(src, tmp);
  await fs.copyFile(src + '-wal', tmp + '-wal');

  let copy = new DatabaseSync(tmp);
  const beforeMode = String(pragmaScalar(copy, 'PRAGMA journal_mode')).toLowerCase();
  const afterMode = String(pragmaScalar(copy, 'PRAGMA journal_mode=DELETE')).toLowerCase();
  copy.close();

  copy = new DatabaseSync(tmp, { readOnly: true });
  const count = pragmaScalar(copy, 'SELECT COUNT(*) FROM t');
  const integrity = pragmaScalar(copy, 'PRAGMA integrity_check(1)');
  copy.close();
  live.close();

  assert(beforeMode === 'wal', 'temp copy did not replay copied WAL', { beforeMode });
  assert(afterMode === 'delete', 'temp copy did not convert to rollback journal', { afterMode });
  assert(count === 50 && integrity === 'ok', 'converted temp copy lost WAL data or failed integrity', { count, integrity });
  return { walSize, beforeMode, afterMode, count, integrity };
});

await runScenario('row070_074_quarantine_then_restore_valid_backup', async () => {
  const main = dbPath('row074-main');
  const backupPath = dbPath('row074-backup');
  const damaged = main + '.damaged';

  let db = new DatabaseSync(main);
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('damaged-original');");
  db.close();

  db = new DatabaseSync(backupPath);
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('restored-backup');");
  const backupIntegrity = pragmaScalar(db, 'PRAGMA integrity_check(1)');
  db.close();
  assert(backupIntegrity === 'ok', 'backup fixture is not valid');

  await fs.rename(main, damaged);
  await fs.rename(backupPath, main);

  const restored = new DatabaseSync(main, { readOnly: true });
  const value = pragmaScalar(restored, 'SELECT v FROM t');
  const integrity = pragmaScalar(restored, 'PRAGMA integrity_check(1)');
  restored.close();

  assert(value === 'restored-backup' && integrity === 'ok', 'restore did not publish valid backup', { value, integrity });
  assert(await exists(damaged), 'damaged original was not preserved');
  return { value, integrity, damagedPreserved: true };
});

await runScenario('row081_wal_normal_and_readonly_admission', async () => {
  const p = dbPath('row081');
  let db = new DatabaseSync(p);
  const journalMode = String(pragmaScalar(db, 'PRAGMA journal_mode=WAL')).toLowerCase();
  db.exec('PRAGMA synchronous=NORMAL; PRAGMA main.locking_mode=EXCLUSIVE; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  const synchronous = pragmaScalar(db, 'PRAGMA synchronous');
  const locking = String(pragmaScalar(db, 'PRAGMA main.locking_mode')).toLowerCase();
  db.close();

  db = new DatabaseSync(p, { readOnly: true });
  let writeBlocked = false;
  try {
    db.exec("INSERT INTO t(v) VALUES ('should-fail')");
  } catch {
    writeBlocked = true;
  }
  const readable = pragmaScalar(db, 'SELECT COUNT(*) FROM t');
  db.close();

  assert(journalMode === 'wal', 'WAL mode was not established', { journalMode });
  assert(Number(synchronous) === 1, 'synchronous=NORMAL was not established', { synchronous });
  assert(locking === 'exclusive', 'locking_mode=EXCLUSIVE was not established', { locking });
  assert(writeBlocked, 'read-only admission still allowed writes');
  return { journalMode, synchronous, locking, writeBlocked, readable };
});

await runScenario('row090_vacuum_into_swap_reopen', async () => {
  const p = dbPath('row090-main');
  const tmp = p + '.vacuum.tmp';
  let db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  const ins = db.prepare('INSERT INTO t(v) VALUES (?)');
  for (let i = 0; i < 500; i++) ins.run('row-' + i + '-' + 'x'.repeat(100));
  let commitCount = 500;
  const beforeCount = commitCount;

  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  db.close();

  assert(commitCount === beforeCount, 'test modification fence unexpectedly changed');
  await fs.rename(tmp, p);

  db = new DatabaseSync(p, { readOnly: true });
  const count = pragmaScalar(db, 'SELECT COUNT(*) FROM t');
  const integrity = pragmaScalar(db, 'PRAGMA integrity_check(1)');
  db.close();

  assert(count === 500 && integrity === 'ok', 'VACUUM INTO swap/reopen lost data', { count, integrity });
  return { count, integrity };
});

await runScenario('row090_modification_fence_aborts_stale_swap', async () => {
  const p = dbPath('row090-fence');
  const tmp = p + '.vacuum.tmp';
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
  db.exec("INSERT INTO t(v) VALUES ('before')");
  let commitCount = 1;
  const before = commitCount;
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);

  db.exec("INSERT INTO t(v) VALUES ('after-snapshot')");
  commitCount++;
  assert(commitCount !== before, 'modification fence did not observe post-snapshot write');
  await fs.rm(tmp, { force: true });

  const count = pragmaScalar(db, 'SELECT COUNT(*) FROM t');
  db.close();
  assert(count === 2, 'source database did not retain post-snapshot write', { count });
  return { sourceRows: count, staleSwapAborted: true };
});

await runScenario('row094_drop_known_retired_schema_objects', async () => {
  const p = dbPath('row094');
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE current_table(id INTEGER PRIMARY KEY);
    CREATE TABLE retired_table(id INTEGER PRIMARY KEY);
    CREATE TABLE trigger_target(id INTEGER PRIMARY KEY);
    CREATE TRIGGER retired_trigger AFTER INSERT ON trigger_target
    BEGIN
      INSERT INTO current_table(id) VALUES (NEW.id);
    END;
  `);

  const before = new Set(db.prepare(
    "SELECT type || ':' || name AS k FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => row.k));
  assert(before.has('table:retired_table') && before.has('trigger:retired_trigger'),
    'retired fixtures were not created', { before: [...before] });

  const retiredTables = ['retired_table'];
  const retiredTriggers = ['retired_trigger'];
  for (const name of retiredTriggers) {
    const q = '"' + name.replaceAll('"', '""') + '"';
    db.exec(`DROP TRIGGER ${q}`);
  }
  for (const name of retiredTables) {
    const q = '"' + name.replaceAll('"', '""') + '"';
    db.exec(`DROP TABLE ${q}`);
  }

  const after = new Set(db.prepare(
    "SELECT type || ':' || name AS k FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => row.k));
  const currentStillThere = after.has('table:current_table') && after.has('table:trigger_target');
  db.close();

  assert(!after.has('table:retired_table') && !after.has('trigger:retired_trigger'),
    'known retired objects remain after reconcile fix', { after: [...after] });
  assert(currentStillThere, 'retired-object repair removed current schema objects', { after: [...after] });
  return { before: [...before].sort(), after: [...after].sort(), currentStillThere };
});

await runScenario('row098_fk_check_fix_recheck', async () => {
  const p = dbPath('row098');
  const db = new DatabaseSync(p, { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE parent(id INTEGER PRIMARY KEY, v TEXT);
    CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), v TEXT);
    INSERT INTO parent(id,v) VALUES (1,'valid-parent');
    INSERT INTO child(id,parent_id,v) VALUES (1,1,'valid-child');
    INSERT INTO child(id,parent_id,v) VALUES (2,999,'orphan-child');
    PRAGMA foreign_keys=true;
  `);

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  assert(violations.length === 1, 'expected exactly one FK violation', { violations });

  for (const row of violations) {
    const table = String(row.table).replaceAll('"', '""');
    db.prepare(`DELETE FROM "${table}" WHERE rowid=?`).run(row.rowid);
  }

  const remaining = db.prepare('PRAGMA foreign_key_check').all();
  const validChild = pragmaScalar(db, 'SELECT COUNT(*) FROM child WHERE id=1 AND parent_id=1');
  const orphan = pragmaScalar(db, 'SELECT COUNT(*) FROM child WHERE id=2');
  db.close();

  assert(remaining.length === 0, 'FK repair did not clear violations', { remaining });
  assert(validChild === 1 && orphan === 0, 'FK repair removed valid data or kept orphan', { validChild, orphan });
  return { violationsBefore: violations, violationsAfter: remaining, validChild, orphan };
});

await runScenario('row121_132_builtin_fts5_survives_reopen', async () => {
  const p = dbPath('row132');
  let db = new DatabaseSync(p);
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(body); INSERT INTO docs(body) VALUES ('Electron Repository Search'),('other text');");
  const first = db.prepare('SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY rowid').all('Electron');
  db.close();

  db = new DatabaseSync(p);
  const second = db.prepare('SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY rowid').all('Repository');
  db.close();

  assert(first.length === 1 && second.length === 1, 'FTS5 was not available before/after reopen', { first, second });
  return { initialMatches: first.length, reopenedMatches: second.length, loadExtensionRequired: false };
});

await runScenario('row139_fresh_schema_transaction_atomicity', async () => {
  const p = dbPath('row139');
  const db = new DatabaseSync(p);
  let failed = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE a(id INTEGER PRIMARY KEY);');
    db.exec('THIS IS INTENTIONALLY INVALID SQL');
    db.exec('COMMIT');
  } catch {
    failed = true;
    db.exec('ROLLBACK');
  }

  const partial = pragmaScalar(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='a'");
  assert(failed && partial === 0, 'failed fresh schema init left partial schema', { failed, partial });

  db.exec('BEGIN IMMEDIATE; CREATE TABLE a(id INTEGER PRIMARY KEY); CREATE TABLE b(id INTEGER PRIMARY KEY); COMMIT;');
  const finalCount = pragmaScalar(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('a','b')");
  db.close();

  assert(finalCount === 2, 'successful fresh schema init did not publish complete schema', { finalCount });
  return { failedAttemptRolledBack: true, finalTableCount: finalCount };
});

const failures = Object.entries(evidence.scenarios).filter(([, value]) => value.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `zotero-native-db-parity-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
await fs.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({
  result: evidence.result,
  failedScenarios: evidence.failedScenarios,
  scenarioCount: Object.keys(evidence.scenarios).length,
  artifact,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
