import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-zotero-schema-reconcile-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  purpose: 'Zotero row095 authoritative-schema reconciliation substrate qualification',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  startedAt: new Date().toISOString(),
  scenarios: {},
};

const authoritative = [
  {
    type: 'table',
    name: 'items',
    sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL)'
  },
  {
    type: 'table',
    name: 'retractedItems',
    sql: 'CREATE TABLE retractedItems (itemID INTEGER PRIMARY KEY, reason TEXT)'
  },
  {
    type: 'index',
    name: 'items_title_idx',
    sql: 'CREATE INDEX items_title_idx ON items(title)'
  },
];

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function existingObjects(db) {
  const rows = db.prepare(
    "SELECT type, name FROM sqlite_master " +
    "WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'"
  ).all();
  return new Set(rows.map(row => `${row.type}:${row.name}`));
}

// Mirrors only Zotero row095's reconcile check/fix semantics:
// - skipReconcile omits this check entirely
// - check-only reports missing current tables/indexes
// - fix executes authoritative CREATE statements for missing objects
function reconcileCurrentSchema(db, { fix = false, skipReconcile = false } = {}) {
  if (skipReconcile) {
    return { ok: true, skipped: true, repaired: [], missing: [] };
  }

  const before = existingObjects(db);
  const missing = authoritative.filter(obj => !before.has(`${obj.type}:${obj.name}`));

  if (!missing.length) {
    return { ok: true, skipped: false, repaired: [], missing: [] };
  }

  if (!fix) {
    return {
      ok: false,
      skipped: false,
      repaired: [],
      missing: missing.map(obj => `${obj.type}:${obj.name}`),
    };
  }

  for (const obj of missing) {
    db.exec(obj.sql);
  }

  const after = existingObjects(db);
  const stillMissing = authoritative.filter(obj => !after.has(`${obj.type}:${obj.name}`));
  return {
    ok: stillMissing.length === 0,
    skipped: false,
    repaired: missing.map(obj => `${obj.type}:${obj.name}`),
    missing: stillMissing.map(obj => `${obj.type}:${obj.name}`),
  };
}

async function runScenario(name, fn) {
  const started = Date.now();
  try {
    evidence.scenarios[name] = {
      result: 'PASS',
      elapsedMs: Date.now() - started,
      ...(await fn()),
    };
  }
  catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Date.now() - started,
      error: { message: error?.message, details: error?.details },
    };
  }
}

function openDb(name) {
  const dbPath = path.join(root, `${name}.sqlite`);
  const db = new DatabaseSync(dbPath);
  for (const obj of authoritative) db.exec(obj.sql);
  return { db, dbPath };
}

await runScenario('check_only_detects_missing_table', async () => {
  const { db } = openDb('missing-table');
  try {
    db.exec('DROP TABLE retractedItems');
    const result = reconcileCurrentSchema(db);
    assert(result.ok === false, 'check-only did not report missing table', result);
    assert(result.missing.includes('table:retractedItems'), 'missing table not identified', result);
    return result;
  }
  finally {
    db.close();
  }
});

await runScenario('fix_recreates_missing_table_from_authoritative_schema', async () => {
  const { db } = openDb('repair-table');
  try {
    db.exec('DROP TABLE retractedItems');
    const result = reconcileCurrentSchema(db, { fix: true });
    assert(result.ok === true, 'fix did not succeed', result);
    assert(result.repaired.includes('table:retractedItems'), 'table was not repaired', result);
    const exists = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='retractedItems'"
    ).get().n;
    assert(exists === 1, 'repaired table not present');
    return result;
  }
  finally {
    db.close();
  }
});

await runScenario('check_only_detects_missing_index', async () => {
  const { db } = openDb('missing-index');
  try {
    db.exec("INSERT INTO items(id,title) VALUES (1,'alpha'),(2,'beta')");
    db.exec('DROP INDEX items_title_idx');
    const result = reconcileCurrentSchema(db);
    assert(result.ok === false, 'check-only did not report missing index', result);
    assert(result.missing.includes('index:items_title_idx'), 'missing index not identified', result);
    const rows = db.prepare('SELECT id,title FROM items ORDER BY id').all();
    assert(rows.length === 2, 'table data changed during check-only', rows);
    return { ...result, rows };
  }
  finally {
    db.close();
  }
});

await runScenario('fix_recreates_missing_index_without_changing_rows', async () => {
  const { db } = openDb('repair-index');
  try {
    db.exec("INSERT INTO items(id,title) VALUES (1,'alpha'),(2,'beta')");
    db.exec('DROP INDEX items_title_idx');
    const result = reconcileCurrentSchema(db, { fix: true });
    assert(result.ok === true, 'fix did not succeed', result);
    assert(result.repaired.includes('index:items_title_idx'), 'index was not repaired', result);
    const rows = db.prepare('SELECT id,title FROM items ORDER BY id').all();
    assert(rows.length === 2 && rows[0].title === 'alpha' && rows[1].title === 'beta',
      'row data changed during index repair', rows);
    return { ...result, rows };
  }
  finally {
    db.close();
  }
});

await runScenario('skip_reconcile_matches_zotero_omission_semantics', async () => {
  const { db } = openDb('skip-reconcile');
  try {
    db.exec('DROP TABLE retractedItems');
    const skipped = reconcileCurrentSchema(db, { fix: false, skipReconcile: true });
    assert(skipped.ok === true && skipped.skipped === true,
      'skipReconcile did not omit reconcile check', skipped);
    const stillMissing = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='retractedItems'"
    ).get().n === 0;
    assert(stillMissing, 'skipReconcile unexpectedly repaired the table');
    const normal = reconcileCurrentSchema(db);
    assert(normal.ok === false && normal.missing.includes('table:retractedItems'),
      'normal check did not detect the still-missing table', normal);
    return { skipped, normal };
  }
  finally {
    db.close();
  }
});

await runScenario('repair_is_idempotent_after_success', async () => {
  const { db } = openDb('idempotent');
  try {
    db.exec('DROP TABLE retractedItems');
    db.exec('DROP INDEX items_title_idx');
    const first = reconcileCurrentSchema(db, { fix: true });
    const second = reconcileCurrentSchema(db, { fix: true });
    assert(first.ok === true, 'first repair failed', first);
    assert(second.ok === true, 'second repair failed', second);
    assert(second.repaired.length === 0 && second.missing.length === 0,
      'second repair was not a no-op', second);
    return { first, second };
  }
  finally {
    db.close();
  }
});

const failures = Object.entries(evidence.scenarios)
  .filter(([, value]) => value.result !== 'PASS');
evidence.result = failures.length ? 'FAIL' : 'PASS';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(
  artifactDir,
  `zotero-schema-reconcile-${process.platform}-${process.arch}.json`
);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));
await fs.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({
  result: evidence.result,
  failedScenarios: evidence.failedScenarios,
  scenarioCount: Object.keys(evidence.scenarios).length,
  artifact,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
