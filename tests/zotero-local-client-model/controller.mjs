import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-zotero-local-client-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const CURRENT = 4;
const MIN_SUPPORTED = 1;
const evidence = {
  schema: 1,
  purpose: 'Qualify Zotero-style logical Library identity + independent local Main materialization + local-only C04 + DB compatibility fail-closed',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  scenarios: {},
};

function assert(ok, message, details) {
  if (ok) return;
  const e = new Error(message);
  e.details = details;
  throw e;
}
function meta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
}
function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function createMain(p, { libraryId, schemaVersion = CURRENT, compatibilityVersion = schemaVersion } = {}) {
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE business(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `);
  setMeta(db, 'library_id', libraryId);
  setMeta(db, 'schema_version', schemaVersion);
  setMeta(db, 'compatibility_version', compatibilityVersion);
  setMeta(db, 'ready', '1');
  db.close();
}
function classify(p) {
  const db = new DatabaseSync(p, { readOnly: true });
  const state = {
    libraryId: meta(db, 'library_id'),
    schemaVersion: Number(meta(db, 'schema_version')),
    compatibilityVersion: Number(meta(db, 'compatibility_version')),
  };
  db.close();
  if (state.schemaVersion < MIN_SUPPORTED) throw new Error('DB_BELOW_MINIMUM');
  if (state.schemaVersion > CURRENT || state.compatibilityVersion > CURRENT) {
    throw new Error('DB_INCOMPATIBLE_NEWER_VERSION');
  }
  return state;
}
function migrateIfSupported(p) {
  const state = classify(p);
  if (state.schemaVersion === CURRENT) return { migrated: false, state };
  const db = new DatabaseSync(p);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let v = state.schemaVersion + 1; v <= CURRENT; v++) {
      setMeta(db, 'migration_' + v, 'done');
    }
    setMeta(db, 'schema_version', CURRENT);
    setMeta(db, 'compatibility_version', CURRENT);
    setMeta(db, 'ready', '1');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return { migrated: true, before: state.schemaVersion, after: CURRENT };
}
function businessWrite(p, value) {
  classify(p);
  const db = new DatabaseSync(p);
  db.prepare('INSERT INTO business(value) VALUES(?)').run(value);
  db.close();
}
function rowCount(p) {
  const db = new DatabaseSync(p, { readOnly: true });
  const n = Number(Object.values(db.prepare('SELECT COUNT(*) FROM business').get())[0]);
  db.close();
  return n;
}
function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' &&
    /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}
async function acquireLocalGate(clientRoot, libraryId) {
  const dir = path.join(clientRoot, 'session');
  await fs.mkdir(dir, { recursive: true });
  const key = crypto.createHash('sha256').update(String(libraryId)).digest('hex');
  const gatePath = path.join(dir, key + '.sqlite');
  const db = new DatabaseSync(gatePath);
  const started = performance.now();
  try {
    db.exec('PRAGMA busy_timeout=250; BEGIN EXCLUSIVE;');
    db.prepare('PRAGMA schema_version').get();
    return {
      acquired: true,
      gatePath,
      elapsedMs: performance.now() - started,
      release() { try { db.exec('ROLLBACK'); } finally { db.close(); } },
    };
  } catch (error) {
    const elapsedMs = performance.now() - started;
    try { db.close(); } catch {}
    if (isBusy(error)) return { acquired: false, gatePath, elapsedMs, reason: 'IN_USE' };
    throw error;
  }
}
async function run(name, fn) {
  const started = Date.now();
  try {
    evidence.scenarios[name] = { result: 'PASS', elapsedMs: Date.now() - started, ...(await fn()) };
  } catch (e) {
    evidence.scenarios[name] = { result: 'FAIL', elapsedMs: Date.now() - started, error: { message: e?.message, details: e?.details } };
  }
}

const libraryId = '11111111-1111-4111-8111-aaaaaaaaaaaa';

await run('S01_same_libraryid_two_local_mains_can_run_concurrently', async () => {
  const a = path.join(root, 'client-a');
  const b = path.join(root, 'client-b');
  await Promise.all([fs.mkdir(a, { recursive: true }), fs.mkdir(b, { recursive: true })]);
  const mainA = path.join(a, 'main.sqlite');
  const mainB = path.join(b, 'main.sqlite');
  createMain(mainA, { libraryId });
  createMain(mainB, { libraryId });
  const gateA = await acquireLocalGate(a, libraryId);
  const gateB = await acquireLocalGate(b, libraryId);
  assert(gateA.acquired && gateB.acquired, 'independent local clients contended unexpectedly', { gateA, gateB });
  businessWrite(mainA, 'A');
  businessWrite(mainB, 'B');
  assert(rowCount(mainA) === 1 && rowCount(mainB) === 1, 'local writes crossed materializations');
  gateA.release();
  gateB.release();
  return { libraryId, distinctMainPaths: mainA !== mainB, bothAcquired: true };
});

await run('S02_same_local_main_second_runtime_is_denied', async () => {
  const c = path.join(root, 'same-local-client');
  await fs.mkdir(c, { recursive: true });
  createMain(path.join(c, 'main.sqlite'), { libraryId });
  const owner = await acquireLocalGate(c, libraryId);
  assert(owner.acquired, 'owner failed');
  const contender = await acquireLocalGate(c, libraryId);
  assert(!contender.acquired && contender.reason === 'IN_USE', 'same local materialization was not denied', contender);
  owner.release();
  const after = await acquireLocalGate(c, libraryId);
  assert(after.acquired, 'same local materialization did not acquire after release', after);
  after.release();
  return { contenderElapsedMs: contender.elapsedMs };
});

await run('S03_supported_old_migrates_only_its_local_main', async () => {
  const a = path.join(root, 'migration-a');
  const b = path.join(root, 'migration-b');
  await Promise.all([fs.mkdir(a, { recursive: true }), fs.mkdir(b, { recursive: true })]);
  const mainA = path.join(a, 'main.sqlite');
  const mainB = path.join(b, 'main.sqlite');
  createMain(mainA, { libraryId, schemaVersion: 2, compatibilityVersion: 2 });
  createMain(mainB, { libraryId, schemaVersion: CURRENT, compatibilityVersion: CURRENT });
  const r = migrateIfSupported(mainA);
  const bBeforeAfter = classify(mainB);
  assert(r.migrated && classify(mainA).schemaVersion === CURRENT, 'supported-old did not migrate');
  assert(bBeforeAfter.schemaVersion === CURRENT, 'other local client was changed');
  return { migratedFrom: 2, migratedTo: CURRENT, otherClientVersion: bBeforeAfter.schemaVersion };
});

await run('S04_future_main_fails_closed_before_business_write', async () => {
  const c = path.join(root, 'future');
  await fs.mkdir(c, { recursive: true });
  const main = path.join(c, 'main.sqlite');
  createMain(main, { libraryId, schemaVersion: CURRENT + 1, compatibilityVersion: CURRENT + 1 });
  const before = rowCount(main);
  let message = '';
  try { businessWrite(main, 'must-not-write'); } catch (e) { message = e.message; }
  const after = rowCount(main);
  assert(message === 'DB_INCOMPATIBLE_NEWER_VERSION', 'future DB was not rejected', { message });
  assert(before === after && after === 0, 'business write happened before fail-closed', { before, after });
  return { message, rowCount: after };
});

await run('S05_one_incompatible_local_client_does_not_block_another_current_client', async () => {
  const a = path.join(root, 'future-a');
  const b = path.join(root, 'current-b');
  await Promise.all([fs.mkdir(a, { recursive: true }), fs.mkdir(b, { recursive: true })]);
  const mainA = path.join(a, 'main.sqlite');
  const mainB = path.join(b, 'main.sqlite');
  createMain(mainA, { libraryId, schemaVersion: CURRENT + 1, compatibilityVersion: CURRENT + 1 });
  createMain(mainB, { libraryId, schemaVersion: CURRENT, compatibilityVersion: CURRENT });
  let aMessage = '';
  try { businessWrite(mainA, 'blocked'); } catch (e) { aMessage = e.message; }
  businessWrite(mainB, 'allowed');
  assert(aMessage === 'DB_INCOMPATIBLE_NEWER_VERSION', 'incompatible client did not fail closed', { aMessage });
  assert(rowCount(mainA) === 0 && rowCount(mainB) === 1, 'local client isolation failed');
  return { incompatibleClient: aMessage, currentClientRows: 1 };
});

await run('S06_library_identity_is_logical_not_main_path', async () => {
  const a = path.join(root, 'identity-a');
  const b = path.join(root, 'identity-b');
  await Promise.all([fs.mkdir(a, { recursive: true }), fs.mkdir(b, { recursive: true })]);
  const mainA = path.join(a, 'main.sqlite');
  const mainB = path.join(b, 'main.sqlite');
  createMain(mainA, { libraryId });
  createMain(mainB, { libraryId });
  const sa = classify(mainA);
  const sb = classify(mainB);
  assert(sa.libraryId === sb.libraryId && mainA !== mainB, 'logical identity was coupled to local path', { sa, sb, mainA, mainB });
  return { libraryId: sa.libraryId, mainA, mainB };
});

const failures = Object.entries(evidence.scenarios).filter(([, v]) => v.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([k]) => k);
evidence.scenarioCount = Object.keys(evidence.scenarios).length;
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `zotero-local-client-model-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
await fs.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({ result: evidence.result, scenarioCount: evidence.scenarioCount, failedScenarios: evidence.failedScenarios, artifact }, null, 2));
if (evidence.result !== 'PASS') process.exitCode = 1;
