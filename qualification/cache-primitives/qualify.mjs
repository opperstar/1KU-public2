import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import cacache from 'cacache';
import { LRUCache } from 'lru-cache';

const here = dirname(fileURLToPath(import.meta.url));
const options = { memoize: false };
const payload = n => Buffer.from(`synthetic-thumbnail-${n}-`.repeat(2048));
async function verifiedRead(cache, key) {
  let bytes = 0;
  for await (const chunk of cacache.get.stream(cache, key, options)) bytes += chunk.length;
  return bytes;
}
async function child(...args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b);
    p.on('error', reject);
    p.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`Child ${code}: ${err}`)));
  });
}
if (process.argv[2] === 'reopen') {
  const [, , , cache, key] = process.argv;
  console.log(JSON.stringify({ bytes: await verifiedRead(cache, key), metadata: (await cacache.get.info(cache, key, options)).metadata }));
} else if (process.argv[2] === 'write') {
  const [, , , cache, id] = process.argv;
  for (let i = 0; i < 20; i++) {
    await cacache.put(cache, 'concurrent', payload(Number(id)), { ...options, metadata: { version: Number(id) } });
    const r = await cacache.get(cache, 'concurrent', options);
    assert.ok(r.data.equals(payload(1)) || r.data.equals(payload(2)));
  }
  console.log(JSON.stringify({ writes: 20 }));
} else {
  const root = await mkdtemp(join(tmpdir(), 'iku-cache-qualification-'));
  const cache = join(root, '中文 space cache');
  const source = join(root, 'synthetic-original.bin');
  const checks = [];
  const check = (name, value = true) => { assert.equal(value, true, name); checks.push(name); };
  const gaps = [];
  try {
    await writeFile(source, payload(42));
    const key = 'source-identity:one-poster';
    const metadata = { sourceVersion: { size: 8192, mtimeMs: 123456 }, recipe: '1024-original-ratio' };
    const first = (await cacache.put(cache, key, payload(1), { ...options, metadata })).toString();
    const old = await cacache.get.info(cache, key, options);
    check('cold publication and metadata', old.integrity === first && old.metadata.recipe === metadata.recipe);
    check('hot verified stream', await verifiedRead(cache, key) === payload(1).length);
    const fresh = await child('reopen', cache, key);
    check('fresh process persisted hit', fresh.bytes === payload(1).length && fresh.metadata.sourceVersion.mtimeMs === 123456);
    await cacache.put(cache, 'another-source-same-bytes', payload(1), options);
    check('content deduplication', (await cacache.get.info(cache, 'another-source-same-bytes', options)).path === old.path);
    await cacache.put(cache, key, payload(2), { ...options, metadata: { ...metadata, sourceVersion: { size: 8193, mtimeMs: 123457 } } });
    const current = await cacache.get.info(cache, key, options);
    check('single key switches current version', current.integrity !== first && current.metadata.sourceVersion.size === 8193);
    check('old path remains readable after replacement', (await readFile(old.path)).equals(payload(1)));
    await cacache.rm.entry(cache, 'another-source-same-bytes');
    check('entry retirement is logical, not physical', await cacache.get.info(cache, 'another-source-same-bytes') === null && (await stat(old.path)).size === payload(1).length);
    // Simulates another process holding only an already delivered URI, as a Card does.
    const stats = await cacache.verify(cache);
    await assert.rejects(access(old.path), { code: 'ENOENT' });
    check('offline verify reclaims retired content', stats.reclaimedCount > 0);
    gaps.push('verify deletes unindexed content even when a different consumer still holds its path; no URI lease');
    const concurrent = await Promise.all([child('write', cache, '1'), child('write', cache, '2')]);
    check('two concurrent processes read only complete content', concurrent.reduce((s, v) => s + v.writes, 0) === 40);
    await writeFile(current.path, Buffer.from('bad'));
    check('info does not validate file bytes', (await cacache.get.info(cache, key, options)).integrity === current.integrity);
    await assert.rejects(verifiedRead(cache, key), e => ['EINTEGRITY', 'EBADSIZE'].includes(e.code));
    check('verified stream rejects corrupt content');
    await cacache.put(cache, key, payload(2), options);
    await assert.rejects(verifiedRead(cache, key), e => ['EINTEGRITY', 'EBADSIZE'].includes(e.code));
    check('re-put alone does not repair immutable corrupt target');
    gaps.push('same content re-put preserves an existing corrupt target; recovery requires explicit safe removal');
    await cacache.verify(cache);
    await cacache.put(cache, key, payload(2), options);
    check('offline verify then put repairs corruption', await verifiedRead(cache, key) === payload(2).length);
    check('source outside cache unchanged by repair and retirement', (await readFile(source)).equals(payload(42)));
    check('no application memoized byte buffers', Object.keys(cacache.clearMemoized()).length === 0);

    const disposed = [];
    // Tiny fixture budget tests semantics; it is NOT a product memory parameter.
    const lru = new LRUCache({ maxSize: 12, sizeCalculation: v => v.bytes, dispose: (v, key, reason) => disposed.push({ key, reason, active: v.active }) });
    const a = { bytes: 4, active: true }, b = { bytes: 4, active: false }, c = { bytes: 4, active: false };
    lru.set('a', a); lru.set('b', b); lru.set('c', c);
    check('declared byte cost exact', lru.calculatedSize === 12);
    check('get reuses exact resource identity', lru.get('a') === a);
    lru.set('d', { bytes: 4, active: false });
    check('least recently used eviction', !lru.has('b') && lru.has('a') && disposed[0].reason === 'evict');
    lru.set('oversize', { bytes: 13, active: false });
    check('oversize entry rejected', !lru.has('oversize') && lru.calculatedSize <= 12);
    lru.set('e', { bytes: 4, active: false }); lru.set('f', { bytes: 4, active: false });
    check('active is not a native pin', disposed.some(v => v.key === 'a' && v.active && v.reason === 'evict'));
    gaps.push('lru-cache does not know Query observers or active View resources; active values can be evicted');
    const beforeClear = disposed.length, beforeSize = lru.size;
    lru.clear();
    check('clear disposes each retained value once', lru.size === 0 && lru.calculatedSize === 0 && disposed.length === beforeClear + beforeSize);
    lru.clear();
    check('repeated clear has no extra disposal', disposed.length === beforeClear + beforeSize);

    const lock = JSON.parse(await readFile(join(here, 'package-lock.json'), 'utf8'));
    const result = { status: 'PRIMITIVES_VERIFIED_NOT_PRODUCTION_QUALIFIED', platform: process.platform, node: process.version, versions: Object.fromEntries(['cacache', 'lru-cache'].map(n => [n, lock.packages[`node_modules/${n}`].version])), lockSha256: createHash('sha256').update(await readFile(join(here, 'package-lock.json'))).digest('hex'), checks, gaps, scope: 'Synthetic local filesystem and declared-cost resources only; no Obsidian, browser native allocation, real Query/Card, user data or production writes.', notRun: ['actual Query/Card byte-budget memory comparison', 'original D03 candidate integration', 'macOS/Linux', 'Obsidian Host'] };
    await writeFile(join(here, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    // mkdtemp creates this exact private fixture root; no user/cache directories are touched.
    await rm(root, { recursive: true, force: true });
  }
}
