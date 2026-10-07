// Public official dependencies and synthetic lifecycle only. No 1KU source or user data.
// This Node/JSDOM probe is not Obsidian/Electron/native animation acceptance.
import fs from 'node:fs';
import { compileFunction } from 'node:vm';
import { createRequire } from 'node:module';
import { setImmediate as idle, setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import {writeHeapSnapshot} from 'node:v8';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
assert.ok(global.gc, 'DIAGNOSTIC_GC_REQUIRED');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://fixture.invalid/' });
for (const k of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','MutationObserver']) globalThis[k] = dom.window[k];
for (const k of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) globalThis[k] = dom.window[k].bind(dom.window);
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = dom.window.matchMedia = media => ({media,matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x:0,y:0,top:0,left:0,right:600,bottom:300,width:600,height:300,toJSON(){return this;} });
const reactEntries=['react','react/jsx-runtime','react/jsx-dev-runtime','react/compiler-runtime','react-dom','react-dom/client','scheduler'];
const vendorEntries=['motion/react','overlayscrollbars','overlayscrollbars-react'];
const require=createRequire(import.meta.url), rendererRequire=createRequire(require.resolve('react-dom/package.json'));
const options={bundle:true,write:false,minify:true,format:'cjs',platform:'browser',target:'es2022',metafile:true,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}};
const makeEntry=entries=>entries.map((e,i)=>`import * as e${i} from ${JSON.stringify(e==='scheduler'?rendererRequire.resolve(e):e)};exports[${JSON.stringify(e)}]=e${i};`).join('\n');
const artifact = async (entries,external=[]) => build({...options,stdin:{contents:makeEntry(entries),resolveDir:process.cwd()},external});
const execute=async (source,reactExports={})=>{
  const module={exports:{}};
  const factory=compileFunction('"use strict";const require=k=>reactExports[k];try{'+source+';resolve(module.exports)}catch(error){reject(error)}',['reactExports','module','exports','resolve','reject']);
  return new Promise((resolve,reject)=>setImmediate(factory,reactExports,module,module.exports,resolve,reject));
};
const react=await artifact(reactEntries), vendor=await artifact(vendorEntries,reactEntries);
const dependencies=await execute(react.outputFiles[0].text);Object.assign(dependencies,await execute(vendor.outputFiles[0].text,dependencies));
const fixture=`
import * as React from 'react';import {createRoot} from 'react-dom/client';
import {motion} from 'motion/react';import {OverlayScrollbars} from 'overlayscrollbars';
import {useOverlayScrollbars} from 'overlayscrollbars-react';
const nativeFs=require('node:fs');
export const identity=React.createContext;
export function mount(container,business){
 const root=createRoot(container);
 function Child(){
  const [count,setCount]=React.useState(0);
  const [initialize,instance]=useOverlayScrollbars({defer:false});
  const ref=React.useCallback(node=>{if(node)initialize({target:node});else instance()?.destroy()},[initialize,instance]);
  React.useEffect(()=>{business.effects++;return()=>{business.cleanups++}},[]);
  return React.createElement(motion.div,{layout:true,initial:false},React.createElement('button',{onClick:()=>{business.clicks++;setCount(n=>n+1)}},String(count)),React.createElement('div',{ref,style:{height:50,width:100}},React.createElement('div',{style:{height:500}},'scroll')));
 }
 root.render(React.createElement(Child));
 return {unmount:()=>root.unmount(),nativeFs:!!nativeFs.readFileSync};
}`;
const alias={name:'qualification-only-independent-official-dependencies',setup(api){
 api.onResolve({filter:/^(?:react(?:\/|$)|react-dom(?:\/|$)|scheduler(?:\/|$)|motion\/react$|overlayscrollbars(?:-react)?$)/},({path})=>({path,namespace:'qualification'}));
 api.onLoad({filter:/.*/,namespace:'qualification'},({path})=>({contents:'module.exports=__dependencies['+JSON.stringify(path)+'];',loader:'js'}));
}};
const builds={};for(const mode of ['current','candidate'])builds[mode]=await build({...options,stdin:{contents:fixture,resolveDir:process.cwd(),loader:'js'},external:['node:fs'],plugins:mode==='candidate'?[alias]:[]});
const results={}, errors=[];const originalError=console.error;console.error=(...args)=>{if(/Invalid hook|Minified React error|uncaught/i.test(args.map(String).join(' ')))errors.push(args.map(String).join(' '));};
const nativeRequire=createRequire(process.execPath);
class QualificationPlugin { constructor(){this.buffer=new Uint8Array(1048576);} }
class QualificationBusiness { constructor(){this.effects=0;this.cleanups=0;this.clicks=0;} }
try {
 for(const mode of ['current','candidate']){
  const refs=[],businessRefs=[],containerRefs=[],checks=[];
  async function generation(){
   const plugin=new QualificationPlugin(), business=new QualificationBusiness();
   const hostRequire=key=>{void plugin;return key==='node:fs'?fs:nativeRequire(key);};
   const module={exports:{}};
   compileFunction(builds[mode].outputFiles[0].text,['require','module','exports','__dependencies'])(hostRequire,module,module.exports,dependencies);
   if(mode==='candidate')assert.equal(module.exports.identity,dependencies.react.createContext);
   const container=document.createElement('div');document.body.append(container);const mounted=module.exports.mount(container,business);
   for(let i=0;i<100&&!container.querySelector('button');i++)await delay(10);
   assert.ok(container.querySelector('button'));await delay(80);
   container.querySelector('button').click();await delay(20);
   assert.equal(container.querySelector('button').textContent,'1');assert.equal(business.clicks,1);assert.equal(business.effects,1);
   mounted.unmount();container.remove();assert.equal(business.cleanups,1);
   // Native cleanup assertion also moves JSDOM's selector TreeWalker back to live document.
   // Heap evidence identified its cached detached last-query node as the synthetic one-object root.
   // This uses normal DOM API, not private cache clearing or a production dependency patch.
   assert.equal(document.querySelector('body').childElementCount,0);
   // JSDOM also caches the last selector event target. Exercise an ordinary outside click and
   // prove the unmounted business handler is absent, without manipulating that private cache.
   document.body.click();assert.equal(business.clicks,1);
   refs.push(new WeakRef(plugin));businessRefs.push(new WeakRef(business));containerRefs.push(new WeakRef(container));
  }
  for(let i=0;i<10;i++){await generation();await delay(30);}
  await delay(1000);for(let i=0;i<8;i++){await idle();global.gc();}
  const firstScan={plugins:refs.filter(r=>r.deref()).length,business:businessRefs.filter(r=>r.deref()).length,containers:containerRefs.filter(r=>r.deref()).length};
  // A deref keeps its target alive until the current job ends. Exit that job before the final
  // witness, rather than forcing GC while snapshot/WeakRef inspection itself pins the target.
  await delay(50);global.gc();await delay(50);global.gc();
  const retained={plugins:refs.filter(r=>r.deref()).length,business:businessRefs.filter(r=>r.deref()).length,containers:containerRefs.filter(r=>r.deref()).length};
  results[mode]={generations:10,firstScan,retained,identity:mode==='candidate'?'same independent React':'per bundle current',controlRootReproduced:mode==='current'?retained.plugins>0:undefined};
  console.log(JSON.stringify({mode,retained}));if(process.argv.includes('--snapshot'))writeHeapSnapshot(mode+'.heapsnapshot');
  // The small JSDOM control need not recreate Obsidian's full module context. Record it honestly;
  // real baseline reproduction belongs to the separate Windows actual-App Host experiment.
  if(mode==='candidate'){assert.equal(retained.plugins,0);assert.equal(retained.business,0);assert.equal(retained.containers,0);}
 }
 assert.equal(errors.length,0);
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,results,scope:'Official public exports, synthetic hooks/click/layout/scroll binding/unmount and diagnostic GC; NO private 1KU source, NO native Host/RSS acceptance'}));
 fs.writeFileSync('result-'+process.platform+'.json',JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,results,errors,reactInputs:Object.keys(react.metafile.inputs),vendorInputs:Object.keys(vendor.metafile.inputs)},null,2));
}finally{console.error=originalError;dom.window.close();}
