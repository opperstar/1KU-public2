import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-zotero-local-library-model-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'Qualify Zotero-equivalent logical-library/local-materialization split for 1KU',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  yjs: '13.6.32',
  startedAt: new Date().toISOString(),
  scenarios: {},
};

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function runScenario(name, fn) {
  const started = Date.now();
  try {
    evidence.scenarios[name] = { result: 'PASS', elapsedMs: Date.now() - started, ...(await fn()) };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Date.now() - started,
      error: { message: error?.message, code: error?.code, details: error?.details },
    };
  }
}

function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR'
    && /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}

function normalizeMainIdentity(mainPath) {
  let value = path.resolve(mainPath);
  if (process.platform === 'win32') value = value.toLowerCase();
  return value;
}

function localMainGatePath(coordRoot, mainPath) {
  const identity = normalizeMainIdentity(mainPath);
  const key = crypto.createHash('sha256').update(identity, 'utf8').digest('hex');
  return path.join(coordRoot, key + '.sqlite');
}

async function acquireLocalMainGate({ coordRoot, mainPath }) {
  await fs.mkdir(coordRoot, { recursive: true });
  const gatePath = localMainGatePath(coordRoot, mainPath);
  const db = new DatabaseSync(gatePath);
  try {
    db.exec('PRAGMA busy_timeout=250; BEGIN EXCLUSIVE;');
    db.prepare('PRAGMA schema_version').get();
    let released = false;
    return {
      acquired: true,
      gatePath,
      release() {
        if (released) return;
        released = true;
        try { db.exec('ROLLBACK'); } finally { db.close(); }
      },
    };
  } catch (error) {
    try { db.close(); } catch {}
    if (isBusy(error)) return { acquired: false, gatePath, reason: 'IN_USE' };
    throw error;
  }
}

function createMain(mainPath, { libraryId, compatibilityVersion, value }) {
  fss.mkdirSync(path.dirname(mainPath), { recursive: true });
  const db = new DatabaseSync(mainPath);
  db.exec(`
    CREATE TABLE library_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE business(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `);
  const put = db.prepare('INSERT INTO library_meta(key,value) VALUES(?,?)');
  put.run('library_id', libraryId);
  put.run('compatibility_version', String(compatibilityVersion));
  db.prepare('INSERT INTO business(id,value) VALUES(1,?)').run(value);
  db.close();
}

function readMeta(db, key) {
  return db.prepare('SELECT value FROM library_meta WHERE key=?').get(key)?.value;
}

function admitLocalMain(mainPath, { expectedLibraryId, maxCompatibilityVersion }) {
  const db = new DatabaseSync(mainPath, { readOnly: true });
  try {
    const libraryId = readMeta(db, 'library_id');
    const compatibilityVersion = Number(readMeta(db, 'compatibility_version'));
    if (libraryId !== expectedLibraryId) throw new Error('LIBRARY_ID_MISMATCH');
    if (!Number.isInteger(compatibilityVersion)) throw new Error('COMPATIBILITY_VERSION_MISSING');
    if (compatibilityVersion > maxCompatibilityVersion) {
      const error = new Error('LOCAL_MAIN_NEWER_THAN_CLIENT_UPGRADE_REQUIRED');
      error.dbCompatibilityVersion = compatibilityVersion;
      error.clientMaxCompatibilityVersion = maxCompatibilityVersion;
      throw error;
    }
    return {
      libraryId,
      compatibilityVersion,
      action: compatibilityVersion === maxCompatibilityVersion ? 'READY' : 'FORWARD_MIGRATION_REQUIRED',
    };
  } finally {
    db.close();
  }
}

function forwardMigrateLocalMain(mainPath, { fromVersion, toVersion }) {
  const db = new DatabaseSync(mainPath);
  try {
    const current = Number(readMeta(db, 'compatibility_version'));
    assert(current === fromVersion, 'migration source version changed', { current, fromVersion });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE library_meta SET value=? WHERE key='compatibility_version'").run(String(toVersion));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function yState(doc) {
  const meta = doc.getMap('meta');
  const items = doc.getMap('items');
  return {
    libraryId: meta.get('libraryId'),
    items: [...items.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))),
  };
}

function makeYDoc(clientId, libraryId) {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  doc.getMap('meta').set('libraryId', libraryId);
  return doc;
}

// A — same local Main must still have one Owner
await runScenario('A1_same_local_main_exactly_one_owner', async () => {
  const libraryId = crypto.randomUUID();
  const mainPath = path.join(root, 'A1', 'local-main.sqlite');
  const coordRoot = path.join(root, 'A1', 'coord');
  createMain(mainPath, { libraryId, compatibilityVersion: 4, value: 'local-main' });

  const first = await acquireLocalMainGate({ coordRoot, mainPath });
  assert(first.acquired, 'first local owner did not acquire');
  const second = await acquireLocalMainGate({ coordRoot, mainPath });
  assert(!second.acquired && second.reason === 'IN_USE', 'same local Main admitted second owner', second);
  assert(first.gatePath === second.gatePath, 'same local Main did not map to same local gate', { first, second });
  first.release();

  const after = await acquireLocalMainGate({ coordRoot, mainPath });
  assert(after.acquired, 'same local Main was not acquirable after release', after);
  after.release();
  return { gateIdentity: 'canonical local Main path', secondOwner: 'DENIED' };
});

await runScenario('A2_different_local_mains_do_not_share_c04_even_with_same_libraryid', async () => {
  const libraryId = crypto.randomUUID();
  const coordRoot = path.join(root, 'A2', 'coord');
  const mainA = path.join(root, 'A2', 'client-A', 'main.sqlite');
  const mainB = path.join(root, 'A2', 'client-B', 'main.sqlite');
  createMain(mainA, { libraryId, compatibilityVersion: 4, value: 'A' });
  createMain(mainB, { libraryId, compatibilityVersion: 4, value: 'B' });

  const [a, b] = await Promise.all([
    acquireLocalMainGate({ coordRoot, mainPath: mainA }),
    acquireLocalMainGate({ coordRoot, mainPath: mainB }),
  ]);
  assert(a.acquired && b.acquired, 'independent local Mains incorrectly blocked each other', { a, b });
  assert(a.gatePath !== b.gatePath, 'different local Mains collapsed to one C04 gate', { a, b });
  a.release();
  b.release();
  return { sameLibraryId: libraryId, bothLocalOwners: 'ACQUIRED' };
});

// B — same logical LibraryId, separate local materializations, Yjs convergence
await runScenario('B1_same_libraryid_separate_local_mains_yjs_converge', async () => {
  const libraryId = crypto.randomUUID();
  const mainA = path.join(root, 'B1', 'client-A', 'main.sqlite');
  const mainB = path.join(root, 'B1', 'client-B', 'main.sqlite');
  createMain(mainA, { libraryId, compatibilityVersion: 4, value: 'A-local' });
  createMain(mainB, { libraryId, compatibilityVersion: 4, value: 'B-local' });

  const docA = makeYDoc(101, libraryId);
  const docB = makeYDoc(202, libraryId);
  docA.getMap('items').set('item-A', { title: 'from-A' });
  docB.getMap('items').set('item-B', { title: 'from-B' });

  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);
  Y.applyUpdate(docA, updateB);
  Y.applyUpdate(docB, updateA);

  const stateA = yState(docA);
  const stateB = yState(docB);
  assert(JSON.stringify(stateA) === JSON.stringify(stateB), 'same logical Library did not converge', { stateA, stateB });
  assert(stateA.libraryId === libraryId, 'logical Library identity changed during convergence', stateA);
  assert(stateA.items.length === 2, 'converged state lost one local contribution', stateA);

  const dbA = new DatabaseSync(mainA, { readOnly: true });
  const dbB = new DatabaseSync(mainB, { readOnly: true });
  const localA = dbA.prepare('SELECT value FROM business WHERE id=1').get()?.value;
  const localB = dbB.prepare('SELECT value FROM business WHERE id=1').get()?.value;
  dbA.close();
  dbB.close();
  assert(localA === 'A-local' && localB === 'B-local', 'local materializations were not independent', { localA, localB });

  return {
    logicalLibraryId: libraryId,
    localMains: 2,
    convergedItems: stateA.items.map(([key]) => key),
  };
});

await runScenario('B2_yjs_update_order_and_reapply_do_not_change_final_logical_state', async () => {
  const libraryId = crypto.randomUUID();
  const sourceA = makeYDoc(301, libraryId);
  const sourceB = makeYDoc(302, libraryId);
  sourceA.getMap('items').set('A', 'alpha');
  sourceB.getMap('items').set('B', 'beta');
  const ua = Y.encodeStateAsUpdate(sourceA);
  const ub = Y.encodeStateAsUpdate(sourceB);

  const left = new Y.Doc();
  Y.applyUpdate(left, ua);
  Y.applyUpdate(left, ub);
  Y.applyUpdate(left, ua);

  const right = new Y.Doc();
  Y.applyUpdate(right, ub);
  Y.applyUpdate(right, ua);
  Y.applyUpdate(right, ub);

  const ls = yState(left);
  const rs = yState(right);
  assert(JSON.stringify(ls) === JSON.stringify(rs), 'Yjs final state depended on artifact order/reapply', { ls, rs });
  assert(ls.libraryId === libraryId, 'logical Library identity missing after merge', ls);
  return { finalState: ls };
});

// C — Zotero-equivalent local DB compatibility admission
await runScenario('C1_newer_local_main_fails_closed_zero_business_write', async () => {
  const libraryId = crypto.randomUUID();
  const main = path.join(root, 'C1', 'main.sqlite');
  createMain(main, { libraryId, compatibilityVersion: 5, value: 'before' });
  const before = await fs.readFile(main);

  let message = '';
  try {
    admitLocalMain(main, { expectedLibraryId: libraryId, maxCompatibilityVersion: 4 });
  } catch (error) {
    message = error.message;
  }

  const after = await fs.readFile(main);
  const db = new DatabaseSync(main, { readOnly: true });
  const business = db.prepare('SELECT value FROM business WHERE id=1').get()?.value;
  db.close();
  assert(message === 'LOCAL_MAIN_NEWER_THAN_CLIENT_UPGRADE_REQUIRED', 'newer Main did not require upgrade', { message });
  assert(before.equals(after), 'newer Main admission mutated DB before fail-closed');
  assert(business === 'before', 'business data changed on incompatible admission', { business });
  return { admission: 'UPGRADE_REQUIRED', zeroMutation: true };
});

await runScenario('C2_supported_old_local_main_forward_migrates_then_ready', async () => {
  const libraryId = crypto.randomUUID();
  const main = path.join(root, 'C2', 'main.sqlite');
  createMain(main, { libraryId, compatibilityVersion: 3, value: 'preserved' });

  const before = admitLocalMain(main, { expectedLibraryId: libraryId, maxCompatibilityVersion: 4 });
  assert(before.action === 'FORWARD_MIGRATION_REQUIRED', 'supported-old Main was not classified for migration', before);
  forwardMigrateLocalMain(main, { fromVersion: 3, toVersion: 4 });
  const after = admitLocalMain(main, { expectedLibraryId: libraryId, maxCompatibilityVersion: 4 });
  assert(after.action === 'READY' && after.compatibilityVersion === 4, 'migrated Main did not become READY', after);

  const db = new DatabaseSync(main, { readOnly: true });
  const business = db.prepare('SELECT value FROM business WHERE id=1').get()?.value;
  db.close();
  assert(business === 'preserved', 'forward migration changed business payload', { business });
  return { before: before.action, after: after.action, business };
});

await runScenario('C3_same_libraryid_clients_can_have_independent_local_db_versions', async () => {
  const libraryId = crypto.randomUUID();
  const oldMain = path.join(root, 'C3', 'old-client', 'main.sqlite');
  const currentMain = path.join(root, 'C3', 'current-client', 'main.sqlite');
  createMain(oldMain, { libraryId, compatibilityVersion: 5, value: 'old-client-local' });
  createMain(currentMain, { libraryId, compatibilityVersion: 4, value: 'current-client-local' });

  let oldClient = '';
  try {
    admitLocalMain(oldMain, { expectedLibraryId: libraryId, maxCompatibilityVersion: 4 });
  } catch (error) {
    oldClient = error.message;
  }
  const currentClient = admitLocalMain(currentMain, { expectedLibraryId: libraryId, maxCompatibilityVersion: 4 });

  assert(oldClient === 'LOCAL_MAIN_NEWER_THAN_CLIENT_UPGRADE_REQUIRED', 'old client did not fail closed on its local Main', { oldClient });
  assert(currentClient.action === 'READY', 'other local materialization was incorrectly blocked', currentClient);
  return {
    logicalLibraryId: libraryId,
    incompatibleLocalClient: 'UPGRADE_REQUIRED',
    compatibleLocalClient: 'READY',
  };
});


// D — shared logical-Library compatibility boundary using current 923 portable library metadata admission
function old923ParsePortableLibraryMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PORTABLE_LIBRARY_METADATA_INVALID');
  }
  if (value.schemaVersion !== 1) throw new Error('PORTABLE_LIBRARY_SCHEMA_UNSUPPORTED');
  if (typeof value.libraryId !== 'string') throw new Error('PORTABLE_LIBRARY_ID_INVALID');
  return { schemaVersion: 1, libraryId: value.libraryId };
}

await runScenario('D1_future_shared_library_format_blocks_old923_before_local_main', async () => {
  const libraryId = crypto.randomUUID();
  const clientRoot = path.join(root, 'D1', 'old923-client');
  const portableRoot = path.join(root, 'D1', 'shared-portable');
  const libraryJson = path.join(portableRoot, 'library.json');
  const localMain = path.join(clientRoot, 'main.sqlite');
  await fs.mkdir(portableRoot, { recursive: true });
  await fs.writeFile(libraryJson, JSON.stringify({ schemaVersion: 2, libraryId }) + '\n');

  let message = '';
  try {
    const metadata = old923ParsePortableLibraryMetadata(JSON.parse(await fs.readFile(libraryJson, 'utf8')));
    // Mirrors current 923 ordering: local DB work is downstream of portable admission.
    createMain(localMain, { libraryId: metadata.libraryId, compatibilityVersion: 4, value: 'should-not-exist' });
  } catch (error) {
    message = error.message;
  }

  assert(message === 'PORTABLE_LIBRARY_SCHEMA_UNSUPPORTED', 'old 923 did not fail closed on future shared Library format', { message });
  assert(!fss.existsSync(localMain), 'old 923 reached local Main after shared Library format rejection', { localMain });
  return { sharedLibraryAdmission: 'UPGRADE_REQUIRED', localMainTouched: false };
});

await runScenario('D2_current_shared_library_format_preserves_same_logical_libraryid', async () => {
  const libraryId = crypto.randomUUID();
  const portableRoot = path.join(root, 'D2', 'shared-portable');
  const libraryJson = path.join(portableRoot, 'library.json');
  await fs.mkdir(portableRoot, { recursive: true });
  await fs.writeFile(libraryJson, JSON.stringify({ schemaVersion: 1, libraryId }) + '\n');
  const metadata = old923ParsePortableLibraryMetadata(JSON.parse(await fs.readFile(libraryJson, 'utf8')));
  assert(metadata.libraryId === libraryId, 'portable admission changed logical Library identity', metadata);
  return { sharedLibraryFormat: 1, logicalLibraryId: metadata.libraryId };
});

const failures = Object.entries(evidence.scenarios).filter(([, value]) => value.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.scenarioCount = Object.keys(evidence.scenarios).length;
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `zotero-local-library-model-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
try { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}

console.log(JSON.stringify({
  result: evidence.result,
  scenarioCount: evidence.scenarioCount,
  failedScenarios: evidence.failedScenarios,
  artifact,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
