import fs from 'node:fs/promises';
import path from 'node:path';
import React, { useSyncExternalStore } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';

const outDir = path.resolve('artifacts');
await fs.mkdir(outDir, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) {
    throw new Error(`${name}: ${detail}`);
  }
}

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
      },
    },
  });
}


async function testUseSyncExternalStoreContract() {
  let snapshot = Object.freeze({ identity: 'A', count: 81 });
  const listeners = new Set();

  const store = {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next) {
      snapshot = Object.freeze(next);
      for (const listener of listeners) listener();
    },
  };

  function Probe() {
    const value = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );
    return React.createElement('output', null, `${value.identity}:${value.count}`);
  }

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });

  const first = renderer.toJSON()?.children?.join('') ?? null;
  record(
    'useSyncExternalStore consumes synchronous initial snapshot',
    first === 'A:81',
    JSON.stringify({ first }),
  );

  await act(async () => {
    store.publish({ identity: 'B', count: 82 });
  });

  const second = renderer.toJSON()?.children?.join('') ?? null;
  record(
    'useSyncExternalStore updates after store publication',
    second === 'B:82',
    JSON.stringify({ second }),
  );

  await act(async () => {
    renderer.unmount();
  });
}

async function testPerSpaceIsolation() {
  const client = newClient();
  const b = deferred();
  let bStarted = 0;
  let cStarted = 0;

  const bPromise = client.fetchQuery({
    queryKey: ['space-item-count', 'B'],
    queryFn: async () => {
      bStarted += 1;
      return b.promise;
    },
  });

  await Promise.resolve();

  const cValue = await client.fetchQuery({
    queryKey: ['space-item-count', 'C'],
    queryFn: async () => {
      cStarted += 1;
      return 303;
    },
  });

  record(
    'per-space key isolation: C is not blocked by slow B',
    cValue === 303 && bStarted === 1 && cStarted === 1,
    JSON.stringify({ cValue, bStarted, cStarted }),
  );

  b.resolve(202);
  const bValue = await bPromise;

  record(
    'late B completion stays on B key',
    bValue === 202
      && client.getQueryData(['space-item-count', 'B']) === 202
      && client.getQueryData(['space-item-count', 'C']) === 303,
    JSON.stringify({
      bValue,
      bCache: client.getQueryData(['space-item-count', 'B']),
      cCache: client.getQueryData(['space-item-count', 'C']),
    }),
  );

  client.clear();
}

async function testPrefixInvalidationActiveOnly() {
  const client = newClient();
  let bFetches = 0;
  let cFetches = 0;

  await client.fetchQuery({
    queryKey: ['space-item-count', 'B'],
    queryFn: async () => {
      bFetches += 1;
      return 81;
    },
  });

  const observer = new QueryObserver(client, {
    queryKey: ['space-item-count', 'C'],
    queryFn: async () => {
      cFetches += 1;
      return 90 + cFetches;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();

  const before = { bFetches, cFetches };

  await client.invalidateQueries({
    queryKey: ['space-item-count'],
    refetchType: 'active',
  });

  const after = { bFetches, cFetches };
  const bState = client.getQueryState(['space-item-count', 'B']);
  const cState = client.getQueryState(['space-item-count', 'C']);

  record(
    'prefix invalidation marks cached keys stale but refetches only active key',
    before.bFetches === 1
      && after.bFetches === 1
      && after.cFetches === before.cFetches + 1
      && bState?.isInvalidated === true
      && cState?.isInvalidated === false,
    JSON.stringify({ before, after, bInvalidated: bState?.isInvalidated, cInvalidated: cState?.isInvalidated }),
  );

  unsubscribe();
  client.clear();
}

async function testLkgSurvivesBackgroundRefresh() {
  const client = newClient();
  client.setQueryData(['space-item-count', 'B'], 81);

  const next = deferred();
  const observer = new QueryObserver(client, {
    queryKey: ['space-item-count', 'B'],
    queryFn: async () => next.promise,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});

  const refetch = observer.refetch();
  await Promise.resolve();

  const during = client.getQueryData(['space-item-count', 'B']);
  record(
    'last-known-good count remains visible while background refresh is pending',
    during === 81,
    JSON.stringify({ during }),
  );

  next.resolve(82);
  await refetch;
  const after = client.getQueryData(['space-item-count', 'B']);

  record(
    'background refresh replaces LKG only after success',
    after === 82,
    JSON.stringify({ after }),
  );

  unsubscribe();
  client.clear();
}


async function testSameKeyInvalidationRejectsLateOldResult() {
  const client = newClient();
  client.setQueryData(['space-item-count', 'B'], 81);

  const first = deferred();
  const second = deferred();
  let calls = 0;

  const observer = new QueryObserver(client, {
    queryKey: ['space-item-count', 'B'],
    queryFn: async () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});

  const oldRefetch = observer.refetch();
  await Promise.resolve();

  const invalidate = client.invalidateQueries({
    queryKey: ['space-item-count', 'B'],
    exact: true,
    refetchType: 'active',
  });
  await Promise.resolve();

  record(
    'same-key invalidation starts a replacement fetch while prior refetch is pending',
    calls === 2,
    JSON.stringify({ calls }),
  );

  second.resolve(82);
  await invalidate;
  const afterNew = client.getQueryData(['space-item-count', 'B']);

  first.resolve(79);
  await oldRefetch.catch(() => {});
  await Promise.resolve();

  const afterLateOld = client.getQueryData(['space-item-count', 'B']);

  record(
    'late pre-invalidation same-key result cannot overwrite newer admitted result',
    afterNew === 82 && afterLateOld === 82,
    JSON.stringify({ afterNew, afterLateOld, calls }),
  );

  unsubscribe();
  client.clear();
}

async function testGcLifetime() {
  const client = newClient();
  client.setQueryData(['space-item-count', 'B'], 81);

  const observer = new QueryObserver(client, {
    queryKey: ['space-item-count', 'B'],
    queryFn: async () => 82,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  unsubscribe();

  await sleep(100);

  record(
    'gcTime Infinity preserves inactive count within one QueryClient generation',
    client.getQueryData(['space-item-count', 'B']) === 81,
    JSON.stringify({ value: client.getQueryData(['space-item-count', 'B']) }),
  );

  client.clear();
}

async function testFreshGenerationDoesNotInheritCache() {
  const oldClient = newClient();
  oldClient.setQueryData(['space-item-count', 'B'], 81);
  oldClient.clear();

  const freshClient = newClient();

  record(
    'fresh QueryClient generation starts without prior count cache',
    oldClient.getQueryData(['space-item-count', 'B']) === undefined
      && freshClient.getQueryData(['space-item-count', 'B']) === undefined,
    JSON.stringify({
      oldAfterClear: oldClient.getQueryData(['space-item-count', 'B']),
      fresh: freshClient.getQueryData(['space-item-count', 'B']),
    }),
  );

  freshClient.clear();
}

let status = 'PASS';
let error = null;

try {
  await testUseSyncExternalStoreContract();
  await testPerSpaceIsolation();
  await testPrefixInvalidationActiveOnly();
  await testLkgSurvivesBackgroundRefresh();
  await testSameKeyInvalidationRejectsLateOldResult();
  await testGcLifetime();
  await testFreshGenerationDoesNotInheritCache();
} catch (err) {
  status = 'FAIL';
  error = err instanceof Error ? err.stack ?? err.message : String(err);
}

const report = {
  qualification: 'P021 Space Count TanStack Query',
  status,
  runtime: process.version,
  package: '@tanstack/react-query@5.101.4 + react@19.2.8',
  contracts: results,
  error,
};

const artifact = path.join(outDir, 'p021-space-count-query.json');
await fs.writeFile(artifact, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));

if (status !== 'PASS') {
  process.exitCode = 1;
}
