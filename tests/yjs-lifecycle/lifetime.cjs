const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {setImmediate:idle}=require('node:timers/promises');
const path=require('node:path');
const mode=process.argv[2], version=JSON.parse(fs.readFileSync(path.join(__dirname,'provenance.json'),'utf8')).version;
const body=fs.readFileSync(path.join(__dirname,mode+'.cjs'),'utf8');
const nativeRequire=createRequire(process.execPath);
const refs=[],constructors=[],documentRefs=[],observerRefs=[];
const warnings=[];console.error=(...args)=>warnings.push(args.map(String).join(' '));
let beforeInitialization;
function loadGeneration(){
 const business={buffer:Buffer.alloc(1048576)};
 // Models Obsidian's require closure holding the old plugin instance.
 const hostRequire=name=>{void business;return nativeRequire(name);};
 const module={exports:{}};
 vm.compileFunction(body,['require','module','exports'],{filename:'actual-yjs-provider-'+mode+'.cjs'})(hostRequire,module,module.exports);
 refs.push(new WeakRef(business));
 return module.exports;
}
async function generation(){
 const facade=loadGeneration();
 if(beforeInitialization===undefined)beforeInitialization=globalThis[Symbol.for('1ku.yjs.runtime')]===undefined;
 await Promise.all([facade.initializeYjsRuntime(version),facade.initializeYjsRuntime(version)]);
 const document=facade.createYjsDocument(41);
 documentRefs.push(new WeakRef(document));
 constructors.push(document.constructor);
 const callbackState={buffer:Buffer.alloc(1024)};
 observerRefs.push(new WeakRef(callbackState));
 const map=facade.yjsMap(document,'fixture');
 const observer=()=>{void callbackState;};
 map.observe(observer);
 map.set('value',1);
 const update=facade.encodeYjsState(document);
 const vector=facade.decodeYjsStateVector(facade.encodeYjsStateVector(document));
 assert.deepEqual(facade.inspectYjsRawUpdateClosure(update).spans.get(41),[{from:0,to:1}]);
 assert.equal(facade.compareYjsStateVectorRelation(vector,vector),'EQUAL');
 assert.equal(facade.compareYjsStateVectorRelation(new Map(),vector),'MISSING');
 const evidence=facade.qualifyYjsUpdates(facade.createYjsQualificationUpdates());
 for(const key of ['converged','duplicateSafe','coldRebuild','invalidBytesRejected'])assert.equal(evidence[key],true);
 await assert.rejects(facade.initializeYjsRuntime('different-version'),/YJS_RUNTIME_VERSION_RESTART_REQUIRED/);
 map.unobserve(observer);
 document.destroy();
}
(async()=>{
 if(!global.gc)throw new Error('DIAGNOSTIC_GC_REQUIRED');
 for(let i=0;i<30;i++)await generation();
 for(let i=0;i<8;i++){await idle();global.gc();}
 const shared=globalThis[Symbol.for('1ku.yjs.runtime')];
 assert.equal(shared.version,version);
 const dependency=await shared.module;
 assert.equal(constructors.every(c=>c===dependency.Doc),true);
 const oldBusinessObjects=refs.filter(r=>r.deref()).length;
 const retainedDocuments=documentRefs.filter(r=>r.deref()).length;
 const retainedObserverStates=observerRefs.filter(r=>r.deref()).length;
 assert.equal(retainedDocuments,0);
 assert.equal(retainedObserverStates,0);
 if(mode==='candidate')assert.equal(oldBusinessObjects,0);
 else assert.ok(oldBusinessObjects>0,'Current real provider must reproduce retention');
 assert.equal(warnings.some(w=>w.includes('Yjs was already imported')),false);
 const result={mode,node:process.version,platform:process.platform,arch:process.arch,generations:30,beforeInitialization,sameConstructor:true,versionFence:true,portableFacade:true,warnings,oldBusinessObjects,retainedDocuments,retainedObserverStates,heap:require('node:v8').getHeapStatistics().used_heap_size,scope:'Fresh Node child, actual current Provider/facade; frozen pre-cutover baseline or actual production candidate, no virtual overlay; simulated Host require business root; native unobserve/destroy; diagnostic GC only'};
 fs.writeFileSync(path.join(__dirname,mode+'-lifetime-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
})().catch(error=>{console.error=process.stderr.write.bind(process.stderr);process.stderr.write(String(error.stack)+'\n');process.exitCode=1;});
