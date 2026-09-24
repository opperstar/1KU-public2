import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryGatePath } from './exclusive-gate.mjs';

const sessionPath = fileURLToPath(new URL('./gate-session.mjs', import.meta.url));
const legacySessionPath = fileURLToPath(new URL('./legacy-main-session.mjs', import.meta.url));
const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1ku-c04-exclusive-'));
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const evidence = {
  schema: 1,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  suiteRoot,
  startedAt: new Date().toISOString(),
  scenarios: {},
};

const children = new Set();
let nextCommandId = 1;

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function unique(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
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

function waitExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child exit timeout')), timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

class Session {
  constructor({ coordRoot, libraryId, libraryRoot, label }) {
    this.events = [];
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [sessionPath, coordRoot, libraryId, libraryRoot, label], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(this.child);
    this.child.once('exit', () => children.delete(this.child));
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { event = { event: 'UNPARSED', raw: line }; }
        this.events.push(event);
        if (event.replyTo != null) {
          const pending = this.pending.get(event.replyTo);
          if (pending) {
            this.pending.delete(event.replyTo);
            if (event.ok) pending.resolve(event);
            else pending.reject(new Error(event.error?.message || 'session command failed'));
          }
        }
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr += String(chunk); });
  }

  async waitEvent(predicate, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = this.events.find(predicate);
      if (hit) return hit;
      if (this.child.exitCode !== null) {
        const fatal = this.events.find(e => e.event === 'FATAL');
        if (fatal) throw new Error(`session fatal: ${fatal.error?.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('waitEvent timeout');
  }

  outcome(timeoutMs = 5000) {
    return this.waitEvent(e => e.event === 'ACQUIRED' || e.event === 'DENIED' || e.event === 'FATAL', timeoutMs);
  }

  command(cmd, timeoutMs = 5000) {
    const id = nextCommandId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`command timeout: ${cmd.cmd}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
    });
  }

  async release() {
    if (this.child.exitCode !== null) return;
    try { await this.command({ cmd: 'RELEASE' }, 2000); } catch {}
    try { await waitExit(this.child, 3000); } catch { this.child.kill('SIGKILL'); }
  }

  async hardKill() {
    if (this.child.exitCode !== null) return;
    this.child.kill('SIGKILL');
    await waitExit(this.child, 3000);
  }
}

async function startSession(args) {
  return new Session(args);
}

async function runScenario(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    evidence.scenarios[name] = { result: 'PASS', elapsedMs: Date.now() - started, ...details };
  } catch (error) {
    evidence.scenarios[name] = {
      result: 'FAIL',
      elapsedMs: Date.now() - started,
      error: { message: error?.message, details: error?.details },
    };
  }
}

await runScenario('static_minimal_candidate', async () => {
  const gateSource = await fs.readFile(fileURLToPath(new URL('./exclusive-gate.mjs', import.meta.url)), 'utf8');
  const sessionSource = await fs.readFile(sessionPath, 'utf8');
  const combined = gateSource + '\n' + sessionSource;
  const imports = [...combined.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  const checks = {
    coreOnlyRuntimeDependencies: imports.every(spec => spec.startsWith('node:') || spec.startsWith('./')),
    noHeartbeat: !/heartbeat/i.test(combined),
    noPidLiveness: !combined.includes('process.pid'),
    noPeriodicTimer: !combined.includes('setInterval('),
    noNativeAddon: !combined.includes('.node'),
    noSocketBroker: !combined.includes('node:net'),
    noMembershipRegistry: !/participant|member_registry|activeRuntimeCount|PENDING_JOIN|CONFLICT/.test(combined),
  };
  assert(Object.values(checks).every(Boolean), 'candidate is not minimal', { checks, imports });
  return { checks, imports };
});

await runScenario('single_winner_under_n_contenders', async () => {
  const rounds = 8;
  const contenderCount = 6;
  const acquireSamples = [];

  for (let round = 0; round < rounds; round++) {
    const roundRoot = path.join(suiteRoot, `race-${round}`);
    const coordRoot = path.join(roundRoot, 'coord');
    const libraryId = unique('library');
    const sessions = [];

    for (let i = 0; i < contenderCount; i++) {
      const libraryRoot = path.join(roundRoot, `root-${i}`);
      await fs.mkdir(libraryRoot, { recursive: true });
      sessions.push(await startSession({ coordRoot, libraryId, libraryRoot, label: `R${round}-C${i}` }));
    }

    const outcomes = await Promise.all(sessions.map(s => s.outcome()));
    const winners = outcomes.map((event, i) => ({ event, session: sessions[i], root: path.join(roundRoot, `root-${i}`) })).filter(x => x.event.event === 'ACQUIRED');
    const losers = outcomes.map((event, i) => ({ event, session: sessions[i], root: path.join(roundRoot, `root-${i}`) })).filter(x => x.event.event === 'DENIED');

    assert(winners.length === 1, 'expected exactly one winner', { round, outcomes });
    assert(losers.length === contenderCount - 1, 'expected all other contenders denied', { round, outcomes });

    acquireSamples.push(winners[0].event.acquireMs);
    assert(await exists(path.join(winners[0].root, 'main.sqlite')), 'winner did not reach Main open/write');

    for (const loser of losers) {
      assert(!(await exists(path.join(loser.root, 'main.sqlite'))), 'loser touched Main', { round, loser: loser.event });
    }

    await winners[0].session.release();
  }

  return {
    rounds,
    contenderCount,
    maxWinnerAcquireMs: Math.max(...acquireSamples),
    avgWinnerAcquireMs: acquireSamples.reduce((a, b) => a + b, 0) / acquireSamples.length,
  };
});

await runScenario('same_library_different_roots_one_claim', async () => {
  const root = path.join(suiteRoot, 'same-library-roots');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('same-library');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  await Promise.all([fs.mkdir(rootA, { recursive: true }), fs.mkdir(rootB, { recursive: true })]);

  const owner = await startSession({ coordRoot, libraryId, libraryRoot: rootA, label: 'A' });
  const ownerOutcome = await owner.outcome();
  assert(ownerOutcome.event === 'ACQUIRED', 'first root did not acquire', ownerOutcome);

  const other = await startSession({ coordRoot, libraryId, libraryRoot: rootB, label: 'B' });
  const otherOutcome = await other.outcome();
  assert(otherOutcome.event === 'DENIED', 'same LibraryId different root bypassed claim', otherOutcome);
  assert(!(await exists(path.join(rootB, 'main.sqlite'))), 'denied root touched Main');

  const ping = await owner.command({ cmd: 'PING' });
  assert(ping.event === 'PONG' && ping.mainOpen, 'owner was disturbed by denied contender', ping);
  await owner.command({ cmd: 'TOUCH_MAIN', event: 'AFTER_DENIED_CONTENDER' });

  await owner.release();
  return {};
});

await runScenario('same_owner_multiview_last_view_release', async () => {
  const root = path.join(suiteRoot, 'views');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('views');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  await Promise.all([fs.mkdir(rootA, { recursive: true }), fs.mkdir(rootB, { recursive: true })]);

  const owner = await startSession({ coordRoot, libraryId, libraryRoot: rootA, label: 'owner' });
  assert((await owner.outcome()).event === 'ACQUIRED', 'owner did not acquire');
  assert((await owner.command({ cmd: 'ADD_VIEW' })).viewCount === 2, 'view 2 did not reuse session');
  assert((await owner.command({ cmd: 'ADD_VIEW' })).viewCount === 3, 'view 3 did not reuse session');
  assert((await owner.command({ cmd: 'CLOSE_VIEW' })).viewCount === 2, 'first close count wrong');
  assert((await owner.command({ cmd: 'CLOSE_VIEW' })).viewCount === 1, 'second close count wrong');

  const blocked = await startSession({ coordRoot, libraryId, libraryRoot: rootB, label: 'blocked' });
  assert((await blocked.outcome()).event === 'DENIED', 'claim released before last view closed');
  assert(!(await exists(path.join(rootB, 'main.sqlite'))), 'blocked contender touched Main');

  await owner.command({ cmd: 'CLOSE_VIEW' });
  await waitExit(owner.child, 3000);

  const next = await startSession({ coordRoot, libraryId, libraryRoot: rootB, label: 'next' });
  assert((await next.outcome()).event === 'ACQUIRED', 'next owner could not acquire after last-view release');
  await next.release();
  return {};
});

await runScenario('hard_crash_releases_without_heartbeat', async () => {
  const root = path.join(suiteRoot, 'crash');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('crash');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  await Promise.all([fs.mkdir(rootA, { recursive: true }), fs.mkdir(rootB, { recursive: true })]);

  const owner = await startSession({ coordRoot, libraryId, libraryRoot: rootA, label: 'crash-owner' });
  assert((await owner.outcome()).event === 'ACQUIRED', 'crash owner did not acquire');
  await owner.hardKill();

  const started = Date.now();
  const next = await startSession({ coordRoot, libraryId, libraryRoot: rootB, label: 'after-crash' });
  const outcome = await next.outcome(3000);
  const releaseMs = Date.now() - started;
  assert(outcome.event === 'ACQUIRED', 'gate did not release after hard crash', { outcome, releaseMs });
  await next.release();

  return { postCrashAcquireMs: releaseMs };
});

await runScenario('maintenance_keeps_claim_while_main_closed', async () => {
  const root = path.join(suiteRoot, 'maintenance');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('maintenance');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  await Promise.all([fs.mkdir(rootA, { recursive: true }), fs.mkdir(rootB, { recursive: true })]);

  const owner = await startSession({ coordRoot, libraryId, libraryRoot: rootA, label: 'maintenance-owner' });
  assert((await owner.outcome()).event === 'ACQUIRED', 'maintenance owner did not acquire');

  const maintenance = owner.command({ cmd: 'MAINTENANCE', holdMs: 400 }, 2000);
  await owner.waitEvent(e => e.event === 'MAINTENANCE_MAIN_CLOSED', 1500);

  const contender = await startSession({ coordRoot, libraryId, libraryRoot: rootB, label: 'maintenance-contender' });
  const blocked = await contender.outcome();
  assert(blocked.event === 'DENIED', 'contender acquired while owner Main was closed for maintenance', blocked);
  assert(!(await exists(path.join(rootB, 'main.sqlite'))), 'maintenance contender touched Main');

  const reopened = await maintenance;
  assert(reopened.event === 'MAINTENANCE_MAIN_REOPENED', 'owner did not reopen Main under same claim', reopened);
  await owner.release();
  return {};
});

await runScenario('legacy_923_main_blocks_target_main_open', async () => {
  const root = path.join(suiteRoot, 'legacy-923');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('legacy');
  const libraryRoot = path.join(root, 'LibraryRoot');
  await fs.mkdir(libraryRoot, { recursive: true });

  const legacy = spawn(process.execPath, [legacySessionPath, libraryRoot], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let legacyBuffer = '';
  legacy.stdout.setEncoding('utf8');
  const legacyOpen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('legacy open timeout')), 3000);
    legacy.stdout.on('data', chunk => {
      legacyBuffer += chunk;
      const nl = legacyBuffer.indexOf('\n');
      if (nl < 0) return;
      const event = JSON.parse(legacyBuffer.slice(0, nl));
      if (event.event === 'LEGACY_OPEN') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });

  let target = null;
  try {
    await legacyOpen;
    target = await startSession({ coordRoot, libraryId, libraryRoot, label: 'target-with-legacy' });
    const whileLegacy = await target.outcome(3000);
    assert(whileLegacy.event !== 'ACQUIRED',
      'target reached Main while legacy 923-style Main connection was still open',
      { whileLegacy });

    legacy.stdin.write('RELEASE\n');
    await waitExit(legacy, 3000);

    const next = await startSession({ coordRoot, libraryId, libraryRoot, label: 'target-after-legacy' });
    const afterLegacy = await next.outcome(3000);
    assert(afterLegacy.event === 'ACQUIRED',
      'target could not acquire/open after legacy Main connection closed',
      { afterLegacy });
    await next.release();

    return { whileLegacy: whileLegacy.event, afterLegacy: afterLegacy.event };
  } finally {
    if (target && target.child.exitCode === null) await target.release();
    if (legacy.exitCode === null) {
      legacy.stdin.write('RELEASE\n');
      try { await waitExit(legacy, 2000); } catch { legacy.kill('SIGKILL'); }
    }
  }
});

await runScenario('different_libraryids_are_independent', async () => {
  const root = path.join(suiteRoot, 'different-libraries');
  const coordRoot = path.join(root, 'coord');
  const rootA = path.join(root, 'A');
  const rootB = path.join(root, 'B');
  await Promise.all([fs.mkdir(rootA, { recursive: true }), fs.mkdir(rootB, { recursive: true })]);

  const a = await startSession({ coordRoot, libraryId: unique('lib-A'), libraryRoot: rootA, label: 'A' });
  const b = await startSession({ coordRoot, libraryId: unique('lib-B'), libraryRoot: rootB, label: 'B' });
  const [oa, ob] = await Promise.all([a.outcome(), b.outcome()]);
  assert(oa.event === 'ACQUIRED' && ob.event === 'ACQUIRED', 'different LibraryIds blocked each other', { oa, ob });
  await Promise.all([a.release(), b.release()]);
  return {};
});

await runScenario('gate_is_outside_library_copy_boundary', async () => {
  const root = path.join(suiteRoot, 'copy-boundary');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('copy');
  const rootA = path.join(root, 'LibraryRoot-A');
  const rootB = path.join(root, 'LibraryRoot-B');
  await fs.mkdir(rootA, { recursive: true });

  const owner = await startSession({ coordRoot, libraryId, libraryRoot: rootA, label: 'copy-owner' });
  assert((await owner.outcome()).event === 'ACQUIRED', 'copy owner did not acquire');

  const gatePath = libraryGatePath(coordRoot, libraryId);
  assert(!gatePath.startsWith(rootA + path.sep), 'gate path lives inside LibraryRoot', { gatePath, rootA });
  await owner.release();

  await fs.cp(rootA, rootB, { recursive: true });
  const copiedEntries = await fs.readdir(rootB);
  assert(!copiedEntries.some(name => name.includes('c04') || name.includes('gate')), 'coordination artifact copied with LibraryRoot', copiedEntries);
  assert(await exists(gatePath), 'coordination artifact unexpectedly lived only inside copied LibraryRoot');

  return { copiedEntries };
});

await runScenario('corrupt_gate_fails_closed', async () => {
  const root = path.join(suiteRoot, 'corrupt-gate');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('corrupt');
  const libraryRoot = path.join(root, 'LibraryRoot');
  await Promise.all([fs.mkdir(coordRoot, { recursive: true }), fs.mkdir(libraryRoot, { recursive: true })]);
  await fs.writeFile(libraryGatePath(coordRoot, libraryId), Buffer.from('NOT_SQLITE'));

  const session = await startSession({ coordRoot, libraryId, libraryRoot, label: 'corrupt' });
  const outcome = await session.outcome();
  assert(outcome.event === 'FATAL', 'corrupt gate did not fail closed', outcome);
  assert(!(await exists(path.join(libraryRoot, 'main.sqlite'))), 'corrupt gate path still reached Main');
  return { fatalMessage: outcome.error?.message };
});

await runScenario('idle_gate_has_no_periodic_write_and_low_cpu', async () => {
  const root = path.join(suiteRoot, 'idle');
  const coordRoot = path.join(root, 'coord');
  const libraryId = unique('idle');
  const libraryRoot = path.join(root, 'LibraryRoot');
  await fs.mkdir(libraryRoot, { recursive: true });

  const owner = await startSession({ coordRoot, libraryId, libraryRoot, label: 'idle-owner' });
  const acquired = await owner.outcome();
  assert(acquired.event === 'ACQUIRED', 'idle owner did not acquire');

  const gatePath = libraryGatePath(coordRoot, libraryId);
  const before = await fs.stat(gatePath);
  const cpu = await owner.command({ cmd: 'CPU_SAMPLE', durationMs: 750 }, 2000);
  const after = await fs.stat(gatePath);
  const cpuMicros = cpu.userMicros + cpu.systemMicros;

  assert(before.mtimeMs === after.mtimeMs, 'idle claim periodically wrote gate file', { before: before.mtimeMs, after: after.mtimeMs });
  assert(cpuMicros < 150000, 'idle session CPU unexpectedly high', { cpuMicros });

  await owner.release();
  return { gateMtimeUnchanged: true, idleCpuMicros750ms: cpuMicros, acquireMs: acquired.acquireMs };
});

for (const child of [...children]) {
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    try { await waitExit(child, 2000); } catch {}
  }
}

const failures = Object.entries(evidence.scenarios).filter(([, value]) => value.result !== 'PASS');
evidence.result = failures.length === 0 ? 'PASS' : 'FAIL';
evidence.failedScenarios = failures.map(([name]) => name);
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `c04-exclusive-gate-${process.platform}-${process.arch}.json`);
await fs.writeFile(artifact, JSON.stringify(evidence, null, 2));

try {
  await fs.rm(suiteRoot, { recursive: true, force: true });
  evidence.cleanup = 'PASS';
} catch (error) {
  evidence.cleanup = `FAIL: ${error.message}`;
}

console.log(JSON.stringify({
  result: evidence.result,
  failedScenarios: evidence.failedScenarios,
  scenarioCount: Object.keys(evidence.scenarios).length,
  artifact,
}, null, 2));

if (evidence.result !== 'PASS') process.exitCode = 1;
