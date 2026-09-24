import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Watchpack from 'watchpack';

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-open-boundaries-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  watchpack: '2.5.2',
  startedAt: new Date().toISOString(),
  scenarios: {},
};

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function runScenario(name, fn) {
  const started = performance.now();
  try {
    const details = await fn();
    evidence.scenarios[name] = {
      result: 'PASS',
      elapsedMs: Math.round(performance.now() - started),
      ...details,
    };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Math.round(performance.now() - started),
      error: { message: error?.message, details: error?.details },
    };
  }
}

async function watchForRescan(root, expectedNames, writer, idleBeforeWriteMs = 700) {
  const expected = new Set(expectedNames);
  let wakeCount = 0;
  let settled = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const wp = new Watchpack({
    aggregateTimeout: 200,
    followSymlinks: false,
    poll: undefined,
  });

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectDone(new Error('WATCHPACK_WAKE_TIMEOUT'));
    }
  }, 10000);

  wp.on('aggregated', async () => {
    wakeCount++;
    try {
      const names = new Set(await fs.readdir(root));
      if ([...expected].every(name => names.has(name)) && !settled) {
        settled = true;
        clearTimeout(timer);
        resolveDone({ wakeCount, discovered: [...expected].sort() });
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectDone(error);
      }
    }
  });

  wp.watch({
    files: [],
    missing: [],
    directories: new Set([root]),
    startTime: Date.now(),
  });

  try {
    await sleep(idleBeforeWriteMs);
    await writer();
    return await done;
  } finally {
    clearTimeout(timer);
    wp.close();
  }
}

await runScenario('Q1_01_idle_runtime_new_artifact_wakes_rescan', async () => {
  const root = path.join(suiteRoot, 'q1-idle');
  await fs.mkdir(root, { recursive: true });
  const target = 'writer-a-artifact.yjs';
  const result = await watchForRescan(root, [target], async () => {
    await fs.writeFile(path.join(root, target), Buffer.from('immutable-artifact-A'));
  }, 1200);
  return {
    contract: 'idle/open watcher -> external arrival -> wake -> directory rescan discovers immutable artifact',
    ...result,
  };
});

await runScenario('Q1_02_coalesced_events_rescan_complete_set', async () => {
  const root = path.join(suiteRoot, 'q1-coalesce');
  await fs.mkdir(root, { recursive: true });
  const names = ['a.yjs', 'b.yjs', 'c.yjs'];
  const result = await watchForRescan(root, names, async () => {
    await Promise.all(names.map((name, i) =>
      fs.writeFile(path.join(root, name), Buffer.from('artifact-' + i))));
  });
  return {
    contract: 'event count/path is hint only; one rescan must discover the complete immutable set',
    ...result,
  };
});

await runScenario('Q1_03_atomic_rename_arrival_wakes_rescan', async () => {
  const root = path.join(suiteRoot, 'q1-rename', 'transport');
  const staging = path.join(suiteRoot, 'q1-rename', 'staging');
  await Promise.all([fs.mkdir(root, { recursive: true }), fs.mkdir(staging, { recursive: true })]);
  const target = 'atomic.yjs';
  const staged = path.join(staging, 'atomic.tmp');
  await fs.writeFile(staged, Buffer.from('atomic-publish'));
  const result = await watchForRescan(root, [target], async () => {
    await fs.rename(staged, path.join(root, target));
  });
  return {
    contract: 'atomic rename into watched transport root still produces eventual wake/rescan',
    ...result,
  };
});

await runScenario('Q2_01_metadata_only_misses_same_size_same_mtime_change', async () => {
  const root = path.join(suiteRoot, 'q2-metadata-collision');
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'media.bin');
  const fixed = new Date('2026-01-02T03:04:05.000Z');

  await fs.writeFile(file, Buffer.from('AAAAAAAA'));
  await fs.utimes(file, fixed, fixed);
  const before = await fs.stat(file);
  const beforeHash = await sha256File(file);

  await fs.writeFile(file, Buffer.from('BBBBBBBB'));
  await fs.utimes(file, fixed, fixed);
  const after = await fs.stat(file);
  const afterHash = await sha256File(file);

  const metadataSame =
    before.size === after.size &&
    Math.trunc(before.mtimeMs) === Math.trunc(after.mtimeMs);

  assert(metadataSame, 'fixture failed to preserve size+mtime', {
    beforeSize: before.size,
    afterSize: after.size,
    beforeMtimeMs: before.mtimeMs,
    afterMtimeMs: after.mtimeMs,
  });
  assert(beforeHash !== afterHash, 'content hash failed to distinguish changed bytes', {
    beforeHash,
    afterHash,
  });

  return {
    contract: 'size+mtime alone cannot prove unchanged content; byte evidence distinguishes it',
    sizeBytes: before.size,
    mtimeMs: Math.trunc(before.mtimeMs),
    beforeHash,
    afterHash,
  };
});

await runScenario('Q2_02_cold_hash_then_steady_state_changed_only', async () => {
  const root = path.join(suiteRoot, 'q2-incremental');
  await fs.mkdir(root, { recursive: true });

  const fileCount = 32;
  const bytesPerFile = 1024 * 1024;
  const prior = new Map();

  for (let i = 0; i < fileCount; i++) {
    const file = path.join(root, 'media-' + String(i).padStart(2, '0') + '.bin');
    await fs.writeFile(file, Buffer.alloc(bytesPerFile, i & 0xff));
  }

  const coldStarted = performance.now();
  let coldBytesHashed = 0;
  for (let i = 0; i < fileCount; i++) {
    const file = path.join(root, 'media-' + String(i).padStart(2, '0') + '.bin');
    const stat = await fs.stat(file);
    const digest = await sha256File(file);
    coldBytesHashed += stat.size;
    prior.set(file, { mtimeMs: stat.mtimeMs, digest, size: stat.size });
  }
  const coldMs = performance.now() - coldStarted;

  const warmStarted = performance.now();
  let warmBytesHashed = 0;
  for (const [file, witness] of prior) {
    const stat = await fs.stat(file);
    if (stat.mtimeMs !== witness.mtimeMs) {
      await sha256File(file);
      warmBytesHashed += stat.size;
    }
  }
  const warmMs = performance.now() - warmStarted;

  const changedFile = path.join(root, 'media-07.bin');
  await sleep(25);
  await fs.writeFile(changedFile, Buffer.alloc(bytesPerFile, 0xee));
  const changedStat = await fs.stat(changedFile);
  if (changedStat.mtimeMs === prior.get(changedFile).mtimeMs) {
    const forced = new Date(prior.get(changedFile).mtimeMs + 2000);
    await fs.utimes(changedFile, forced, forced);
  }

  let deltaBytesHashed = 0;
  const deltaStarted = performance.now();
  let changedCount = 0;
  for (const [file, witness] of prior) {
    const stat = await fs.stat(file);
    if (stat.mtimeMs !== witness.mtimeMs) {
      await sha256File(file);
      deltaBytesHashed += stat.size;
      changedCount++;
    }
  }
  const deltaMs = performance.now() - deltaStarted;

  assert(warmBytesHashed === 0, 'unchanged steady state unexpectedly hashed bytes', {
    warmBytesHashed,
  });
  assert(changedCount === 1 && deltaBytesHashed === bytesPerFile,
    'single changed file did not bound full-byte hashing to that file', {
      changedCount,
      deltaBytesHashed,
      bytesPerFile,
    });

  const coldMiB = coldBytesHashed / (1024 * 1024);
  return {
    contract: 'cold path may hash all required bytes; steady state reuses mtime witness and hashes only changed/new files',
    fileCount,
    bytesPerFile,
    coldBytesHashed,
    coldElapsedMs: Math.round(coldMs),
    coldMiBPerSec: Number((coldMiB / (coldMs / 1000)).toFixed(2)),
    warmBytesHashed,
    warmElapsedMs: Math.round(warmMs),
    deltaChangedFiles: changedCount,
    deltaBytesHashed,
    deltaElapsedMs: Math.round(deltaMs),
  };
});

const failures = Object.entries(evidence.scenarios)
  .filter(([, value]) => value.result !== 'PASS')
  .map(([name]) => name);
evidence.result = failures.length === 0 ? 'PASS' : 'FAIL';
evidence.failedScenarios = failures;
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(
  artifactDir,
  'open-boundaries-' + process.platform + '-' + process.arch + '.json',
);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));

try {
  await fs.rm(suiteRoot, { recursive: true, force: true });
  evidence.cleanup = 'PASS';
} catch (error) {
  evidence.cleanup = 'FAIL: ' + error.message;
}

console.log(JSON.stringify({
  result: evidence.result,
  failedScenarios: failures,
  scenarioCount: Object.keys(evidence.scenarios).length,
  artifact,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
