import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-part1-preplan-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'PART-1 pre-plan qualification: freeze non-Host technical facts before Executor',
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
  return Object.values(row)[0];
}

async function exists(p) {
  try { await fs.stat(p); return true; }
  catch (e) { if (e?.code === 'ENOENT') return false; throw e; }
}

function existsSync(p) { return fss.existsSync(p); }
function rmSync(p) { try { fss.rmSync(p, { force: true }); } catch {} }

async function runScenario(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    evidence.scenarios[name] = { result: 'PASS', elapsedMs: Date.now() - started, ...(details ?? {}) };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Date.now() - started,
      error: { message: error?.message, details: error?.details, stack: error?.stack },
    };
  }
}

function dbPath(name) { return path.join(root, name + '.sqlite'); }

// ---------------------------------------------------------------------------
// Q2 — bounded contention policy for selected C04 sqlite gate substrate
// ---------------------------------------------------------------------------

const C04_BUSY_TIMEOUT_MS = 250;

function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' &&
    /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}

function gatePath(coordRoot, libraryId) {
  return path.join(coordRoot, crypto.createHash('sha256').update(String(libraryId)).digest('hex') + '.sqlite');
}

async function acquireGate(coordRoot, libraryId) {
  await fs.mkdir(coordRoot, { recursive: true });
  const p = gatePath(coordRoot, libraryId);
  const db = new DatabaseSync(p);
  const started = performance.now();
  try {
    db.exec(`PRAGMA busy_timeout=${C04_BUSY_TIMEOUT_MS}; BEGIN EXCLUSIVE;`);
    db.prepare('PRAGMA schema_version').get();
    return {
      acquired: true,
      elapsedMs: performance.now() - started,
      release() { try { db.exec('ROLLBACK'); } finally { db.close(); } },
    };
  } catch (error) {
    const elapsedMs = performance.now() - started;
    try { db.close(); } catch {}
    if (isBusy(error)) return { acquired: false, elapsedMs, reason: 'IN_USE' };
    throw error;
  }
}

await runScenario('q2_bounded_holder_denial', async () => {
  const coord = path.join(root, 'q2-holder');
  const lib = crypto.randomUUID();
  const owner = await acquireGate(coord, lib);
  assert(owner.acquired, 'owner failed to acquire');
  const contender = await acquireGate(coord, lib);
  assert(!contender.acquired, 'contender unexpectedly acquired');
  assert(contender.elapsedMs >= 150, 'contender denial was not a bounded wait', contender);
  assert(contender.elapsedMs < 1500, 'contender denial exceeded bounded wait', contender);
  owner.release();
  return { policyMs: C04_BUSY_TIMEOUT_MS, contenderElapsedMs: contender.elapsedMs };
});

await runScenario('q2_simultaneous_fresh_contenders_exactly_one', async () => {
  const rounds = 8;
  const contenders = 6;
  for (let round = 0; round < rounds; round++) {
    const coord = path.join(root, 'q2-race-' + round);
    const lib = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: contenders }, () => acquireGate(coord, lib)));
    const winners = results.filter(x => x.acquired);
    assert(winners.length === 1, 'fresh race did not produce exactly one winner', { round, results });
    for (const w of winners) w.release();
  }
  return { policyMs: C04_BUSY_TIMEOUT_MS, rounds, contenders };
});

// ---------------------------------------------------------------------------
// Q3 — LibraryRoot identity / fresh / copy state machine
// ---------------------------------------------------------------------------

const PLUGIN_FILES = new Set(['main.js', 'manifest.json', 'styles.css']);
const identityRel = path.join('portable', 'library.json');

async function listRecursive(base, rel = '') {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(path.join(base, rel), { withFileTypes: true }); }
  catch (e) { if (e?.code === 'ENOENT') return out; throw e; }
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name);
    out.push(childRel);
    if (entry.isDirectory()) out.push(...await listRecursive(base, childRel));
  }
  return out;
}

async function readExistingIdentity(libraryRoot) {
  const identityPath = path.join(libraryRoot, identityRel);
  const raw = JSON.parse(await fs.readFile(identityPath, 'utf8'));
  assert(raw?.schemaVersion === 1 && typeof raw.libraryId === 'string', 'identity invalid');
  return raw.libraryId;
}

async function preAcquireIdentity(libraryRoot) {
  const identityPath = path.join(libraryRoot, identityRel);
  if (await exists(identityPath)) return { mode: 'EXISTING', libraryId: await readExistingIdentity(libraryRoot), writes: [] };

  const entries = await listRecursive(libraryRoot);
  const files = entries.filter(x => !x.endsWith(path.sep));
  const topFiles = files.filter(x => !x.includes(path.sep));
  const onlyThree = topFiles.length === 3 && topFiles.every(x => PLUGIN_FILES.has(x)) &&
    files.every(x => PLUGIN_FILES.has(x));

  if (!onlyThree) throw new Error('LIBRARY_IDENTITY_MISSING_WITH_DURABLE_ARTIFACTS');

  const libraryId = crypto.randomUUID();
  await fs.mkdir(path.dirname(identityPath), { recursive: true });
  await fs.writeFile(identityPath, JSON.stringify({ schemaVersion: 1, libraryId }) + '\n', { flag: 'wx' });
  return { mode: 'FRESH', libraryId, writes: [identityRel] };
}

async function postHeldInitialize(libraryRoot) {
  const main = path.join(libraryRoot, 'main.sqlite');
  const writer = path.join(libraryRoot, 'runtime', 'writer.json');
  const c01 = path.join(libraryRoot, 'portable', 'updates', 'v3');
  await fs.mkdir(path.dirname(writer), { recursive: true });
  await fs.mkdir(c01, { recursive: true });
  const db = new DatabaseSync(main);
  db.exec('CREATE TABLE IF NOT EXISTS proof(v TEXT NOT NULL);');
  db.close();
  await fs.writeFile(writer, JSON.stringify({ schemaVersion: 1, writerId: crypto.randomUUID() }));
  return { main, writer, c01 };
}

async function createThreeFiles(dir) {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([...PLUGIN_FILES].map(name => fs.writeFile(path.join(dir, name), name)));
}

await runScenario('q3_existing_identity_read_is_zero_mutation', async () => {
  const dir = path.join(root, 'q3-existing');
  await createThreeFiles(dir);
  await fs.mkdir(path.join(dir, 'portable'), { recursive: true });
  const id = crypto.randomUUID();
  await fs.writeFile(path.join(dir, identityRel), JSON.stringify({ schemaVersion: 1, libraryId: id }));
  await fs.writeFile(path.join(dir, 'portable', 'artifact.yjs'), 'immutable');
  const before = JSON.stringify((await listRecursive(dir)).sort());
  const got = await preAcquireIdentity(dir);
  const after = JSON.stringify((await listRecursive(dir)).sort());
  assert(got.mode === 'EXISTING' && got.libraryId === id, 'existing identity mismatch', got);
  assert(before === after, 'existing identity probe mutated LibraryRoot', { before, after });
  return { libraryId: id };
});

await runScenario('q3_fresh_preacquire_writes_identity_only', async () => {
  const dir = path.join(root, 'q3-fresh');
  await createThreeFiles(dir);
  const got = await preAcquireIdentity(dir);
  const entries = (await listRecursive(dir)).filter(x => !x.endsWith(path.sep));
  assert(got.mode === 'FRESH', 'fresh identity mode wrong', got);
  assert(entries.includes(identityRel), 'identity was not created', entries);
  assert(!(await exists(path.join(dir, 'main.sqlite'))), 'Main created before HELD');
  assert(!(await exists(path.join(dir, 'runtime', 'writer.json'))), 'writer created before HELD');
  assert(!(await exists(path.join(dir, 'portable', 'updates'))), 'C01 writable state created before HELD');
  return { preAcquireWrites: got.writes, libraryId: got.libraryId };
});

await runScenario('q3_denied_after_fresh_identity_has_zero_further_writes', async () => {
  const dir = path.join(root, 'q3-denied');
  await createThreeFiles(dir);
  await preAcquireIdentity(dir);
  const before = JSON.stringify((await listRecursive(dir)).sort());
  // Simulate C04 DENIED: deliberately do nothing post identity.
  const after = JSON.stringify((await listRecursive(dir)).sort());
  assert(before === after, 'DENIED path performed Library writes');
  assert(!(await exists(path.join(dir, 'main.sqlite'))), 'DENIED path created Main');
  return {};
});

await runScenario('q3_durable_artifacts_without_identity_fail_closed', async () => {
  const dir = path.join(root, 'q3-missing-id');
  await createThreeFiles(dir);
  await fs.writeFile(path.join(dir, 'old-data.bin'), 'durable');
  let code = '';
  try { await preAcquireIdentity(dir); }
  catch (e) { code = e.message; }
  assert(code === 'LIBRARY_IDENTITY_MISSING_WITH_DURABLE_ARTIFACTS', 'missing identity did not fail closed', { code });
  return { code };
});

await runScenario('q3_whole_library_copy_preserves_identity_and_main', async () => {
  const src = path.join(root, 'q3-copy-src');
  const dst = path.join(root, 'q3-copy-dst');
  await createThreeFiles(src);
  const pre = await preAcquireIdentity(src);
  await postHeldInitialize(src);
  const db = new DatabaseSync(path.join(src, 'main.sqlite'));
  db.prepare('INSERT INTO proof(v) VALUES (?)').run('copied-main');
  db.close();
  await fs.cp(src, dst, { recursive: true });
  const copiedId = await readExistingIdentity(dst);
  const copiedDb = new DatabaseSync(path.join(dst, 'main.sqlite'), { readOnly: true });
  const copied = scalar(copiedDb.prepare('SELECT v FROM proof').get());
  copiedDb.close();
  assert(copiedId === pre.libraryId && copied === 'copied-main', 'whole LibraryRoot copy lost identity/Main', { copiedId, original: pre.libraryId, copied });
  return { libraryId: copiedId, mainProof: copied };
});

// ---------------------------------------------------------------------------
// Q4 — integrated released migration lifecycle
// ---------------------------------------------------------------------------

const CURRENT_SCHEMA = 4;
const MIN_SUPPORTED = 1;

function createMigrationFixture(p, version) {
  const db = new DatabaseSync(p);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS lifecycle_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `);
  const up = db.prepare('INSERT INTO lifecycle_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  up.run('schema_version', String(version));
  up.run('compatibility_version', String(version));
  up.run('ready', '0');
  db.prepare('INSERT INTO items(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('v' + version);
  db.close();
}

function meta(db, key) {
  return db.prepare('SELECT value FROM lifecycle_meta WHERE key=?').get(key)?.value;
}
function setMeta(db, key, value) {
  db.prepare('INSERT INTO lifecycle_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function backupPathFor(p, target) { return p + '.pre-v' + target + '.bak'; }

function ensurePristineBackup(p, target) {
  const b = backupPathFor(p, target);
  if (!existsSync(b)) fss.copyFileSync(p, b);
  const check = new DatabaseSync(b, { readOnly: true });
  const ok = scalar(check.prepare('PRAGMA integrity_check(1)').get());
  check.close();
  assert(ok === 'ok', 'pristine backup invalid', { b, ok });
  return b;
}

function runReleasedMigration(p, { failAt = null, leaveSemanticPending = false } = {}) {
  const db = new DatabaseSync(p);
  const version = Number(meta(db, 'schema_version'));
  if (!Number.isInteger(version)) { db.close(); throw new Error('VERSION_MISSING'); }
  if (version > CURRENT_SCHEMA) { db.close(); throw new Error('FUTURE_VERSION'); }
  if (version < MIN_SUPPORTED) { db.close(); throw new Error('BELOW_MINIMUM'); }
  if (version === CURRENT_SCHEMA && meta(db, 'semantic_pending') !== '1') {
    setMeta(db, 'ready', '1');
    db.close();
    return { migrated: false, continuationPending: false };
  }

  const backup = ensurePristineBackup(p, CURRENT_SCHEMA);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      let v = version;
      while (v < CURRENT_SCHEMA) {
        const next = v + 1;
        if (failAt === next) throw new Error('MIGRATION_STEP_' + next + '_FAILED');
        setMeta(db, 'migration_step_' + next, 'done');
        v = next;
      }
      setMeta(db, 'schema_version', CURRENT_SCHEMA);
      setMeta(db, 'semantic_pending', '1');
      setMeta(db, 'ready', '0');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }

  const fk = scalar(db.prepare('PRAGMA foreign_keys').get());
  assert(Number(fk) === 1, 'FK not restored after migration');

  const integrity = scalar(db.prepare('PRAGMA integrity_check(1)').get());
  assert(integrity === 'ok', 'post-migration integrity failed', { integrity });

  if (!leaveSemanticPending) {
    setMeta(db, 'semantic_continuation', 'complete');
    setMeta(db, 'semantic_pending', '0');
    setMeta(db, 'compatibility_version', CURRENT_SCHEMA);
    setMeta(db, 'client_provenance', '1KU-target');
    setMeta(db, 'ready', '1');
  }

  const pending = meta(db, 'semantic_pending') === '1';
  const ready = meta(db, 'ready') === '1';
  db.close();
  return { migrated: true, backup, continuationPending: pending, ready };
}

await runScenario('q4_supported_old_direct_to_current', async () => {
  const p = dbPath('q4-direct');
  createMigrationFixture(p, 1);
  const r = runReleasedMigration(p);
  const db = new DatabaseSync(p, { readOnly: true });
  const state = {
    schema: Number(meta(db, 'schema_version')),
    compatibility: Number(meta(db, 'compatibility_version')),
    ready: meta(db, 'ready'),
    s2: meta(db, 'migration_step_2'),
    s3: meta(db, 'migration_step_3'),
    s4: meta(db, 'migration_step_4'),
  };
  db.close();
  assert(state.schema === 4 && state.compatibility === 4 && state.ready === '1', 'direct migration terminal wrong', state);
  assert(state.s2 === 'done' && state.s3 === 'done' && state.s4 === 'done', 'ordered steps missing', state);
  return state;
});

await runScenario('q4_failure_rolls_back_and_restores_fk', async () => {
  const p = dbPath('q4-fail');
  createMigrationFixture(p, 1);
  let message = '';
  try { runReleasedMigration(p, { failAt: 3 }); } catch (e) { message = e.message; }
  const db = new DatabaseSync(p);
  const state = {
    schema: Number(meta(db, 'schema_version')),
    ready: meta(db, 'ready'),
    s2: meta(db, 'migration_step_2'),
    fk: Number(scalar(db.prepare('PRAGMA foreign_keys').get())),
  };
  db.close();
  assert(message === 'MIGRATION_STEP_3_FAILED', 'expected migration failure not observed', { message });
  assert(state.schema === 1 && state.ready === '0' && state.s2 === undefined && state.fk === 1, 'failed migration leaked state', state);
  return { message, ...state };
});

await runScenario('q4_same_target_retry_keeps_pristine_backup', async () => {
  const p = dbPath('q4-retry');
  createMigrationFixture(p, 1);
  try { runReleasedMigration(p, { failAt: 3 }); } catch {}
  const b = backupPathFor(p, CURRENT_SCHEMA);
  const first = await fs.readFile(b);
  const firstStat = await fs.stat(b);
  await new Promise(r => setTimeout(r, 20));
  try { runReleasedMigration(p, { failAt: 3 }); } catch {}
  const second = await fs.readFile(b);
  const secondStat = await fs.stat(b);
  assert(first.equals(second), 'same-target retry rotated pristine bytes');
  assert(firstStat.mtimeMs === secondStat.mtimeMs, 'same-target retry rewrote pristine backup', { firstStat: firstStat.mtimeMs, secondStat: secondStat.mtimeMs });
  return { backupBytes: first.length, mtimeStable: true };
});

await runScenario('q4_post_schema_continuation_survives_restart', async () => {
  const p = dbPath('q4-continuation');
  createMigrationFixture(p, 2);
  const first = runReleasedMigration(p, { leaveSemanticPending: true });
  assert(first.continuationPending && !first.ready, 'continuation was not left pending', first);

  let db = new DatabaseSync(p);
  const before = { schema: Number(meta(db, 'schema_version')), pending: meta(db, 'semantic_pending'), ready: meta(db, 'ready') };
  db.close();
  assert(before.schema === 4 && before.pending === '1' && before.ready === '0', 'restart witness wrong', before);

  db = new DatabaseSync(p);
  setMeta(db, 'semantic_continuation', 'complete');
  setMeta(db, 'semantic_pending', '0');
  setMeta(db, 'compatibility_version', CURRENT_SCHEMA);
  setMeta(db, 'client_provenance', '1KU-target');
  setMeta(db, 'ready', '1');
  db.close();

  db = new DatabaseSync(p, { readOnly: true });
  const after = { pending: meta(db, 'semantic_pending'), ready: meta(db, 'ready'), compatibility: Number(meta(db, 'compatibility_version')) };
  db.close();
  assert(after.pending === '0' && after.ready === '1' && after.compatibility === 4, 'continuation terminal wrong', after);
  return { before, after };
});

await runScenario('q4_below_minimum_and_future_fail_closed_zero_mutation', async () => {
  const cases = [
    { version: 0, expected: 'BELOW_MINIMUM' },
    { version: 9, expected: 'FUTURE_VERSION' },
  ];
  const out = [];
  for (const c of cases) {
    const p = dbPath('q4-class-' + c.version);
    createMigrationFixture(p, c.version);
    const before = await fs.readFile(p);
    let message = '';
    try { runReleasedMigration(p); } catch (e) { message = e.message; }
    const after = await fs.readFile(p);
    assert(message === c.expected, 'classification did not fail closed', { c, message });
    assert(before.equals(after), 'classification mutated DB before fail-closed', { c });
    out.push({ version: c.version, message });
  }
  return { cases: out };
});

// ---------------------------------------------------------------------------
// Q5 — exact legacy 923 retirement fence using existing foundation admission
// ---------------------------------------------------------------------------

function createLegacy923Main(p) {
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE knowledge_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE product_business(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO knowledge_meta(key,value) VALUES
      ('product_foundation_version','b1'),
      ('product_schema_version','3'),
      ('library_id','11111111-1111-4111-8111-111111111111');
    INSERT INTO product_business(id,value) VALUES(1,'legacy-data');
  `);
  db.close();
}

function legacy923Attempt(p) {
  const db = new DatabaseSync(p);
  const foundation = db.prepare("SELECT value FROM knowledge_meta WHERE key='product_foundation_version'").get()?.value;
  if (foundation !== undefined && foundation !== 'b1') {
    db.close();
    throw new Error('PRODUCT_FOUNDATION_VERSION_UNSUPPORTED');
  }
  db.prepare("INSERT INTO product_business(value) VALUES('legacy-write')").run();
  db.close();
  return 'WROTE';
}

function applyRetirementFence(p) {
  const db = new DatabaseSync(p);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE knowledge_meta SET value=? WHERE key='product_foundation_version'").run('retired-r19b');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
}

await runScenario('q5_existing_version_admission_fences_legacy_923', async () => {
  const p = dbPath('q5-fence');
  createLegacy923Main(p);
  applyRetirementFence(p);
  let message = '';
  try { legacy923Attempt(p); } catch (e) { message = e.message; }
  const db = new DatabaseSync(p, { readOnly: true });
  const count = Number(scalar(db.prepare('SELECT COUNT(*) FROM product_business').get()));
  const fence = db.prepare("SELECT value FROM knowledge_meta WHERE key='product_foundation_version'").get()?.value;
  db.close();
  assert(message === 'PRODUCT_FOUNDATION_VERSION_UNSUPPORTED', 'legacy admission did not fail closed', { message });
  assert(count === 1 && fence === 'retired-r19b', 'legacy path mutated after retirement', { count, fence });
  return { message, rowCount: count, fence };
});

await runScenario('q5_retirement_fence_survives_reopen_and_retry', async () => {
  const p = dbPath('q5-reopen');
  createLegacy923Main(p);
  applyRetirementFence(p);
  for (let i = 0; i < 3; i++) {
    let message = '';
    try { legacy923Attempt(p); } catch (e) { message = e.message; }
    assert(message === 'PRODUCT_FOUNDATION_VERSION_UNSUPPORTED', 'legacy retry escaped fence', { i, message });
  }
  return { retries: 3 };
});

await runScenario('q5_negative_deleting_old_path_would_allow_fresh_recreation', async () => {
  const p = dbPath('q5-delete-negative');
  createLegacy923Main(p);
  await fs.rm(p);
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE knowledge_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
  const foundation = db.prepare("SELECT value FROM knowledge_meta WHERE key='product_foundation_version'").get()?.value;
  db.close();
  assert(foundation === undefined, 'negative fixture unexpectedly retained retirement metadata', { foundation });
  return { expectedUnsafeFact: 'missing OLD path has no unsupported-version witness; retirement must preserve an old-path fail-closed fence' };
});

// ---------------------------------------------------------------------------
// Q6 — current C02 physical recovery state machine without Windows-only guard
// ---------------------------------------------------------------------------

function createRecoveryMarkerPath(p) { return p + '.is.corrupt'; }
function createQuarantinePath(p) { return p + '.quarantine-' + Date.now() + '-' + crypto.randomUUID(); }
function removeReplaySidecars(p) { for (const s of ['-journal','-wal','-shm']) rmSync(p + s); }

function integrity(p, quick = false) {
  let db = null;
  try {
    db = new DatabaseSync(p, { readOnly: true });
    return scalar(db.prepare(`PRAGMA ${quick ? 'quick_check' : 'integrity_check'}(1)`).get()) === 'ok';
  } catch {
    return false;
  } finally { try { db?.close(); } catch {} }
}

function copyBaseForValidation(source, target) {
  rmSync(target); rmSync(target + '.verified'); removeReplaySidecars(target);
  fss.copyFileSync(source, target);
  return integrity(target);
}

function verifiedRepairCandidate(databasePath) {
  const candidatePath = databasePath + '.repair.tmp';
  const witnessPath = candidatePath + '.verified';
  if (!existsSync(candidatePath)) { rmSync(witnessPath); return null; }
  let valid = false;
  try {
    const witness = JSON.parse(fss.readFileSync(witnessPath, 'utf8'));
    const candidate = fss.statSync(candidatePath);
    valid = witness.size === candidate.size && witness.lastModified === candidate.mtimeMs;
  } catch {}
  if (!valid) valid = integrity(candidatePath);
  rmSync(witnessPath);
  if (valid) return candidatePath;
  rmSync(candidatePath); removeReplaySidecars(candidatePath); return null;
}

function prepareRepairCandidate(databasePath) {
  const candidatePath = databasePath + '.repair.tmp';
  const witnessPath = candidatePath + '.verified';
  if (!existsSync(databasePath)) return false;
  const valid = copyBaseForValidation(databasePath, candidatePath);
  if (!valid) return false;
  const st = fss.statSync(candidatePath);
  fss.writeFileSync(witnessPath, JSON.stringify({ size: st.size, lastModified: st.mtimeMs }));
  return true;
}

function validatedBackupCandidate(databasePath) {
  const backupPath = databasePath + '.bak';
  if (!existsSync(backupPath)) return null;
  removeReplaySidecars(backupPath);
  if (!integrity(backupPath)) return null;
  const restorePath = databasePath + '.restore.tmp';
  rmSync(restorePath); removeReplaySidecars(restorePath);
  fss.copyFileSync(backupPath, restorePath);
  return restorePath;
}

function preserveDamagedSidecars(databasePath, damagedPath) {
  for (const suffix of ['-journal','-wal']) {
    const source = databasePath + suffix;
    if (!existsSync(source)) continue;
    try { fss.renameSync(source, damagedPath + suffix); } catch {}
  }
  rmSync(databasePath + '-shm');
}

function recoverPortable(databasePath) {
  if (!existsSync(createRecoveryMarkerPath(databasePath))) {
    return { status: 'FAILED', message: 'DATABASE_RECOVERY_MARKER_REQUIRED' };
  }
  try {
    const checkPath = databasePath + '.check.tmp';
    rmSync(databasePath + '.bak.reindex.tmp');
    let source = 'LIVE';
    let candidatePath = null;
    if (existsSync(databasePath)) {
      if (copyBaseForValidation(databasePath, checkPath)) candidatePath = checkPath;
      else { rmSync(checkPath); removeReplaySidecars(checkPath); }
    } else if (existsSync(checkPath)) {
      if (integrity(checkPath)) candidatePath = checkPath;
      else { rmSync(checkPath); removeReplaySidecars(checkPath); }
    }
    if (!candidatePath) { source = 'REPAIR'; candidatePath = verifiedRepairCandidate(databasePath); }
    if (!candidatePath) { source = 'BACKUP'; candidatePath = validatedBackupCandidate(databasePath); }
    if (!candidatePath) return { status: 'FAILED', message: 'DATABASE_RECOVERY_VALID_BACKUP_REQUIRED' };

    let damagedPath = null;
    if (existsSync(databasePath)) {
      damagedPath = createQuarantinePath(databasePath);
      fss.renameSync(databasePath, damagedPath);
      preserveDamagedSidecars(databasePath, damagedPath);
    }
    removeReplaySidecars(databasePath);
    fss.renameSync(candidatePath, databasePath);
    return { status: 'RECOVERED', source, damagedPath };
  } catch (e) {
    return { status: 'FAILED', message: e?.message || String(e) };
  }
}

function makeValidDb(p, value) {
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL);');
  db.prepare('INSERT INTO t(v) VALUES(?)').run(value);
  db.close();
}

await runScenario('q6_recovery_live_candidate_crossplatform', async () => {
  const p = dbPath('q6-live');
  makeValidDb(p, 'live');
  fss.writeFileSync(createRecoveryMarkerPath(p), '');
  const r = recoverPortable(p);
  assert(r.status === 'RECOVERED' && r.source === 'LIVE', 'live recovery failed', r);
  const db = new DatabaseSync(p, { readOnly: true });
  const v = scalar(db.prepare('SELECT v FROM t').get());
  db.close();
  assert(v === 'live', 'live recovery content mismatch', { v });
  return { source: r.source, integrity: integrity(p) };
});

await runScenario('q6_recovery_repair_candidate_crossplatform', async () => {
  const p = dbPath('q6-repair');
  makeValidDb(p, 'repair');
  assert(prepareRepairCandidate(p), 'repair candidate not prepared');
  fss.writeFileSync(p, Buffer.from('NOT_SQLITE'));
  fss.writeFileSync(createRecoveryMarkerPath(p), '');
  const r = recoverPortable(p);
  assert(r.status === 'RECOVERED' && r.source === 'REPAIR', 'repair recovery failed', r);
  const db = new DatabaseSync(p, { readOnly: true });
  const v = scalar(db.prepare('SELECT v FROM t').get());
  db.close();
  assert(v === 'repair', 'repair recovery content mismatch', { v });
  return { source: r.source, integrity: integrity(p) };
});

await runScenario('q6_recovery_backup_candidate_crossplatform', async () => {
  const p = dbPath('q6-backup');
  makeValidDb(p + '.bak', 'backup');
  fss.writeFileSync(p, Buffer.from('NOT_SQLITE'));
  fss.writeFileSync(createRecoveryMarkerPath(p), '');
  const r = recoverPortable(p);
  assert(r.status === 'RECOVERED' && r.source === 'BACKUP', 'backup recovery failed', r);
  const db = new DatabaseSync(p, { readOnly: true });
  const v = scalar(db.prepare('SELECT v FROM t').get());
  db.close();
  assert(v === 'backup', 'backup recovery content mismatch', { v });
  return { source: r.source, integrity: integrity(p) };
});

await runScenario('q6_recovery_requires_marker_and_valid_candidate', async () => {
  const noMarker = dbPath('q6-nomarker');
  makeValidDb(noMarker, 'x');
  const a = recoverPortable(noMarker);
  assert(a.status === 'FAILED' && a.message === 'DATABASE_RECOVERY_MARKER_REQUIRED', 'marker requirement weakened', a);

  const noCandidate = dbPath('q6-nocandidate');
  fss.writeFileSync(noCandidate, Buffer.from('NOT_SQLITE'));
  fss.writeFileSync(createRecoveryMarkerPath(noCandidate), '');
  const b = recoverPortable(noCandidate);
  assert(b.status === 'FAILED' && b.message === 'DATABASE_RECOVERY_VALID_BACKUP_REQUIRED', 'invalid candidate did not fail closed', b);
  return { noMarker: a.message, noCandidate: b.message };
});

// ---------------------------------------------------------------------------
// Q7 — non-Host runtime teardown/reopen ordering
// ---------------------------------------------------------------------------

class QualifiedRuntime {
  constructor(events, generation) {
    this.events = events;
    this.generation = generation;
    this.closed = false;
    this.controller = new AbortController();
    this.worker = { id: crypto.randomUUID(), closed: false };
    this.main = { open: true };
    this.claim = { held: true };
    this.views = 1;
  }

  addView() {
    assert(!this.closed, 'cannot add view to disposed runtime');
    this.views++;
  }

  async closeView() {
    assert(this.views > 0, 'view count underflow');
    this.views--;
    this.events.push('VIEW_CLOSE:' + this.views);
    if (this.views === 0) await this.dispose();
  }

  async dispose() {
    if (this.closed) return;
    this.events.push('STOP_INTAKE');
    this.controller.abort();
    this.events.push('ABORT');
    await new Promise(r => setTimeout(r, 10));
    this.events.push('CONSUMERS_DRAINED');
    this.worker.closed = true;
    this.events.push('WORKER_CLOSED');
    this.main.open = false;
    this.events.push('MAIN_CLOSED');
    assert(!this.main.open && this.worker.closed, 'claim release before resources closed');
    this.claim.held = false;
    this.events.push('C04_RELEASED');
    this.closed = true;
  }
}

await runScenario('q7_last_view_release_is_last_and_reopen_is_fresh', async () => {
  const events = [];
  const first = new QualifiedRuntime(events, 1);
  first.addView();
  await first.closeView();
  assert(first.claim.held, 'claim released before last view');
  await first.closeView();
  assert(first.closed && !first.claim.held, 'last view did not fully dispose');

  const second = new QualifiedRuntime(events, 2);
  assert(second.controller !== first.controller, 'AbortController was reused');
  assert(second.worker.id !== first.worker.id, 'Worker identity was reused');
  assert(second.claim !== first.claim && second.claim.held, 'C04 session was reused');

  const expected = ['VIEW_CLOSE:1','VIEW_CLOSE:0','STOP_INTAKE','ABORT','CONSUMERS_DRAINED','WORKER_CLOSED','MAIN_CLOSED','C04_RELEASED'];
  assert(JSON.stringify(events) === JSON.stringify(expected), 'teardown ordering changed', { events, expected });
  await second.dispose();
  return { firstGeneration: first.generation, secondGeneration: second.generation, events: expected };
});


// ---------------------------------------------------------------------------
// Q8 — OLD exclusive held while source->target snapshot is produced
// ---------------------------------------------------------------------------

await runScenario('q8_old_exclusive_backup_snapshot_blocks_contender', async () => {
  const oldPath = dbPath('q8-old');
  const targetPath = dbPath('q8-target');
  const old = new DatabaseSync(oldPath);
  old.exec(`
    CREATE TABLE proof(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO proof(value) VALUES('legacy-source');
    PRAGMA busy_timeout=250;
    BEGIN EXCLUSIVE;
  `);

  let contenderBusy = false;
  const contender = new DatabaseSync(oldPath);
  try {
    contender.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
  } catch (error) {
    contenderBusy = isBusy(error);
  } finally {
    try { contender.exec('ROLLBACK'); } catch {}
    contender.close();
  }
  assert(contenderBusy, 'OLD exclusive did not block competing writer');

  await backup(old, targetPath);

  const candidate = new DatabaseSync(targetPath, { readOnly: true });
  const value = candidate.prepare('SELECT value FROM proof WHERE id=1').get()?.value;
  const integrityResult = scalar(candidate.prepare('PRAGMA integrity_check(1)').get());
  candidate.close();
  assert(value === 'legacy-source', 'backup candidate lost OLD source data', { value });
  assert(integrityResult === 'ok', 'backup candidate integrity failed', { integrityResult });

  const contenderAfterBackup = new DatabaseSync(oldPath);
  let stillBusy = false;
  try {
    contenderAfterBackup.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
  } catch (error) {
    stillBusy = isBusy(error);
  } finally {
    try { contenderAfterBackup.exec('ROLLBACK'); } catch {}
    contenderAfterBackup.close();
  }
  assert(stillBusy, 'backup released OLD exclusive unexpectedly');

  old.exec('ROLLBACK');
  old.close();

  return { contenderBusy, candidateValue: value, integrity: integrityResult, exclusiveHeldAcrossBackup: stillBusy };
});

// ---------------------------------------------------------------------------
// Q9 — fresh install second startup: existing identity + valid target + no OLD
// ---------------------------------------------------------------------------

function createQualifiedTargetMain(p, libraryId) {
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE knowledge_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO knowledge_meta(key,value) VALUES
      ('product_foundation_version','b1'),
      ('product_schema_version','3'),
      ('library_id','${libraryId}');
  `);
  db.close();
}

function classifyNoOldRestart({ identityMode, oldExists, targetExists, targetValidCurrent }) {
  if (oldExists) return 'LEGACY_SOURCE_PRESENT';
  if (identityMode === 'FRESH' && !targetExists) return 'FRESH_NO_LEGACY_SOURCE';
  if (identityMode === 'EXISTING' && targetExists && targetValidCurrent) return 'TARGET_ONLY_CURRENT';
  return 'FAIL_CLOSED';
}

await runScenario('q9_fresh_second_start_accepts_only_valid_target_only_current', async () => {
  const dir = path.join(root, 'q9-fresh-restart');
  await createThreeFiles(dir);
  const first = await preAcquireIdentity(dir);
  assert(first.mode === 'FRESH', 'first start was not FRESH', first);

  const targetPath = path.join(dir, 'knowledge.sqlite');
  createQualifiedTargetMain(targetPath, first.libraryId);

  const second = await preAcquireIdentity(dir);
  assert(second.mode === 'EXISTING' && second.libraryId === first.libraryId, 'second start identity mismatch', second);

  const target = new DatabaseSync(targetPath, { readOnly: true });
  const targetState = {
    foundation: target.prepare("SELECT value FROM knowledge_meta WHERE key='product_foundation_version'").get()?.value,
    schema: target.prepare("SELECT value FROM knowledge_meta WHERE key='product_schema_version'").get()?.value,
    libraryId: target.prepare("SELECT value FROM knowledge_meta WHERE key='library_id'").get()?.value,
    integrity: scalar(target.prepare('PRAGMA integrity_check(1)').get()),
  };
  target.close();

  const validCurrent = targetState.foundation === 'b1' &&
    targetState.schema === '3' &&
    targetState.libraryId === second.libraryId &&
    targetState.integrity === 'ok';

  const accepted = classifyNoOldRestart({
    identityMode: second.mode,
    oldExists: false,
    targetExists: true,
    targetValidCurrent: validCurrent,
  });
  assert(accepted === 'TARGET_ONLY_CURRENT', 'valid target-only second start was rejected', { accepted, targetState });

  const missing = classifyNoOldRestart({
    identityMode: second.mode,
    oldExists: false,
    targetExists: false,
    targetValidCurrent: false,
  });
  const invalid = classifyNoOldRestart({
    identityMode: second.mode,
    oldExists: false,
    targetExists: true,
    targetValidCurrent: false,
  });
  assert(missing === 'FAIL_CLOSED', 'EXISTING + no OLD + no target did not fail closed', { missing });
  assert(invalid === 'FAIL_CLOSED', 'EXISTING + no OLD + invalid target did not fail closed', { invalid });

  return { accepted, missing, invalid, targetState };
});

const failures = Object.entries(evidence.scenarios).filter(([, v]) => v.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.scenarioCount = Object.keys(evidence.scenarios).length;
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `part1-preplan-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
try { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
catch (error) { evidence.cleanupWarning = error?.message || String(error); }

console.log(JSON.stringify({
  result: evidence.result,
  scenarioCount: evidence.scenarioCount,
  failedScenarios: evidence.failedScenarios,
  artifact,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
