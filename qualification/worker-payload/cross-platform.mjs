// Generic native/transport fixture only. No Main/App/DB facts or user data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { expose } from 'comlink';
import { createWorkerPayloadBanner, readWorkerPayloadArtifact } from './worker-payload.mjs';

const nativeRequire = createRequire(import.meta.url);
const db = '/* trusted synthetic DB text */'.repeat(10000);
const nav = '/* trusted synthetic navigation text */'.repeat(10000);
const banner = createWorkerPayloadBanner(db, nav);
assert.equal(banner.includes(db), false);
assert.deepEqual(readWorkerPayloadArtifact(banner), {DATABASE: db, KNOWLEDGE_SEARCH_NAVIGATION: nav});
let reads = 0;
const readers = compileFunction(banner + ';return {db:IKU_READ_DATABASE_WORKER_SOURCE,nav:IKU_READ_KNOWLEDGE_SEARCH_NAVIGATION_WORKER_SOURCE};', ['require'])((name) => { reads++; return nativeRequire(name); });
assert.equal(reads, 0);
await Promise.all([readers.db().then((text) => assert.equal(text, db)), readers.nav().then((text) => assert.equal(text, nav))]);
assert.equal(reads, 2);

const apiModule = {exports: {}};
compileFunction(readFileSync(new URL('./navigation-runtime.cjs', import.meta.url), 'utf8'), ['require','module','exports'])(nativeRequire, apiModule, apiModule.exports);
const createRuntime = apiModule.exports.createKnowledgeSearchNavigationWorkerRuntime;
const workers = [], urls = [], posted = [];
const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
URL.createObjectURL = (blob) => { const url = createUrl(blob); urls.push(url); return url; };
URL.revokeObjectURL = (url) => { assert.ok(urls.includes(url)); urls.splice(urls.indexOf(url),1); revokeUrl(url); };
globalThis.Worker = class {
  errors = [];
  constructor() {
    const {port1,port2} = new MessageChannel();
    this.client = port1; this.server = port2;
    workers.push(this);
    expose({ initialize: async()=>undefined, beginRebuild:async()=>undefined, beginMatch:async()=>({matchId:'fixture'}), dispose:async()=>undefined }, port2);
    port1.start(); port2.start();
  }
  postMessage(...args) { posted.push('posted'); this.client.postMessage(...args); }
  addEventListener(type, listener) { if(type==='error') this.errors.push(listener); else this.client.addEventListener(type,listener); }
  removeEventListener(type,listener) { this.client.removeEventListener(type,listener); }
  terminate() { this.client.close(); this.server.close(); }
  fail() { for(const listener of this.errors) listener({message:'fixture-loss'}); }
};
let release;
let acquisitions = 0;
const runtime = createRuntime({loadWorkerSource:()=>{ acquisitions++; return new Promise((resolve)=>{release=resolve;}); }});
assert.equal(acquisitions,0);
const first=runtime.initialize(), second=runtime.beginRebuild();
assert.equal(acquisitions,1); assert.equal(workers.length,0);
release(nav); await Promise.all([first,second]);
assert.equal(workers.length,1);
posted.length=0;
await runtime.beginMatch({},()=>posted.push('observed'));
assert.deepEqual(posted.slice(0,2),['posted','observed']);
workers[0].fail();
const rebuild=runtime.initialize(); assert.equal(acquisitions,2);
release(nav); await rebuild; assert.equal(workers.length,2);
const closing=runtime.dispose(); assert.equal(runtime.dispose(),closing); await closing;
await assert.rejects(runtime.initialize(), /WORKER_DISPOSED/u);
assert.equal(urls.length,0);
const pendingRuntime=createRuntime({loadWorkerSource:()=>new Promise((resolve)=>{release=resolve;})});
const pending=pendingRuntime.initialize();
const rejected=assert.rejects(pending,/WORKER_DISPOSED/u);
const disposed=pendingRuntime.dispose();
release(nav); await rejected; await disposed;
assert.equal(workers.length,2); assert.equal(urls.length,0);
const unused=createRuntime({loadWorkerSource:()=>{throw new Error('unexpected-decode');}});
await unused.dispose();
const failed=createRuntime({loadWorkerSource:async()=>{throw new Error('decode-failure');}});
await assert.rejects(failed.initialize(),/decode-failure/u); await failed.dispose();

// Exact canonical DB source-acquisition function; no SQLite/Product initialization.
const databaseModule={exports:{}};
compileFunction(readFileSync(new URL('./database-source.cjs',import.meta.url),'utf8'),['module'])(databaseModule);
const controller=new AbortController();
const dbUrl=databaseModule.exports({signal:controller.signal,loadWorkerSource:()=>new Promise((resolve)=>{release=resolve;})});
const dbRejected=assert.rejects(dbUrl,{name:'AbortError'});
controller.abort(); release(db); await dbRejected;
assert.equal(urls.length,0);
const url=await databaseModule.exports({loadWorkerSource:readers.db});
URL.revokeObjectURL(url); assert.equal(urls.length,0);
URL.createObjectURL=createUrl; URL.revokeObjectURL=revokeUrl;
console.log(JSON.stringify({platform:process.platform,node:process.version,result:'PASS',scope:'actual generic source-acquisition and Navigation transport; native gzip/Blob/Comlink; no Main, App, real browser Worker, SQLite or Host'}));
