import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const dir = fileURLToPath(new URL('.', import.meta.url));
const root = process.cwd();
const read = p => readFileSync(p, 'utf8');
const save = (p, value) => writeFileSync(dir + p, JSON.stringify(value, null, 2));
const evaluate = source => { const m = { exports: {} }; compileFunction(source, ['require','module','exports'])(require,m,m.exports); return m.exports; };
const collect = async () => { for (let n = 0; n < 6; n++) { await new Promise(setImmediate); global.gc(); } };
const product = { image: [{ size: 1024, type: 'image/png' }], name: 'sample', category: 'cat', price: 10, description: 'some description' };
const user = { first_name: 'John', last_name: 'Smith', email: 'j@example.com', phone: '1', role: 'user', status: 'active' };
const profile = { firstname: 'John', lastname: 'Smith', email: 'j@example.com', contactno: '1', country: 'US', city: 'NY', jobs: [] };
const demo = { name: 'John', email: 'j@example.com', age: 18, password: 'abcdefgh', phone: '1234567890', website: '', bio: 'some description', country: 'us', framework: 'react', interests: ['tech'], gender: 'other', newsletter: false, rating: 5, otp: '123456', tags: ['tag'], terms: true };
const advanced = { username:'john', email:'j@example.com', password:'abcdefgh', confirmPassword:'abcdefgh', team:{name:'team',size:1},members:[{name:'A',role:'dev'}],country:'us',state:'ny' };
const samples = { productSchema:product, userSchema:user, profileSchema:profile, demoFormSchema:demo, advancedSchema:advanced, productFormSchema:product, authSchema:{email:'j@example.com'} };
const norm = r => r.success ? {success:true,value:r.data ?? r.output} : {success:false,paths:(r.error?.issues ?? r.issues).map(x => (x.path ?? []).map(k => typeof k === 'object' ? k.key : k))};
const messages = r => (r.error?.issues ?? r.issues ?? []).map(x => ({path:(x.path??[]).map(k=>typeof k==='object'?k.key:k),message:x.message}));

if (process.argv[2] === 'child') {
  const name = process.argv[3];
  const purpose = process.argv[4];
  const source = read(dir + name + '.cjs');
  const init = [];
  if (purpose === 'performance') {
  for (let n=0;n<15;n++) { const start=performance.now(); const a=evaluate(source); a.parse(a.productSchema,product); init.push(performance.now()-start); }
  await collect();
  const api=evaluate(source);
  const timings={};
  for(const [key,value] of Object.entries(samples)) {
    for(let n=0;n<2000;n++) api.parse(api[key],value);
    const rounds=[]; let success=0;
    for(let round=0;round<7;round++) {const start=performance.now();for(let n=0;n<10000;n++)success+=api.parse(api[key],n%2?value:{}).success?1:0;rounds.push((performance.now()-start)/10000*1000);}
    assert.equal(success,35000); timings[key]={medianMicroseconds:rounds.sort((a,b)=>a-b)[3],rounds:7,operationsPerRound:10000,mix:'50% valid / 50% empty'};
  }
  save(name+'-performance-result.json',{name,node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,initMedianMs:init.sort((a,b)=>a-b)[7],timings});
  process.exit(0);
  }
  // Deliberately retain one complete dependency realm while dropping business exports.
  const dependencySource=read(dir + name + '-dependency.cjs');
  let dependency=evaluate(dependencySource);
  let bridge=key=>key===(name==='zod'?'zod':'valibot')?dependency:require(key);
  const businessSource=read(dir+name+'-external.cjs');
  const schemas=[],probes=[],factories=[];
  function generation() {
    const m={exports:{}};compileFunction(businessSource,['require','module','exports'])(bridge,m,m.exports);
    const a=m.exports;
    assert.equal(a.parse(a.productSchema,product).success,true);
    assert.equal(a.parse(a.callbackSchema,'ok').success,true);
    assert.equal(a.parse(a.callbackSchema,'bad').success,false);
    assert.equal(a.callbackSchema['~standard'].validate('ok').value,'ok');
    probes.push(a.probe);factories.push(new WeakRef(a.businessFactory));schemas.push(new WeakRef(a.callbackSchema),new WeakRef(a.productSchema));
  }
  for(let n=0;n<30;n++){generation();await collect();}
  await collect();
  function counts(){return {business:probes.filter(p=>p.deref()).length,factories:factories.filter(p=>p.deref()).length,schemas:schemas.filter(p=>p.deref()).length};}
  const whileDependencyCached=counts();
  bridge=undefined;dependency=undefined;
  await collect();const afterDependencyRelease=counts();
  save(name+'-lifecycle-result.json',{name,node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,generations:30,whileDependencyCached,afterDependencyRelease,admission:Object.values(whileDependencyCached).every(v=>v===0)&&Object.values(afterDependencyRelease).every(v=>v===0),scope:'Fresh Node child; no performance/inline generations beforehand; exact CJS source; callbacks + Standard Schema; GC only in isolated diagnostic; not Obsidian Host'});
  process.exit(0);
}

const entry={zod:true,valibot:true};const sizes={};
for(const name of Object.keys(entry)){
 const dependency=(await build({entryPoints:[require.resolve(name)],bundle:true,write:false,format:'cjs',platform:'node',target:'es2022',minify:true,logLevel:'silent'})).outputFiles[0].text;
 writeFileSync(dir+name+'-dependency.cjs',dependency);
 writeFileSync(dir+name+'-external.cjs',read(dir+name+'.cjs'));
 sizes[name]={standaloneBusinessFixtureBytes:Buffer.byteLength(read(dir+name+'.cjs')),completeDependencyBytes:Buffer.byteLength(dependency)};
}
const z=evaluate(read(dir+'zod.cjs')),v=evaluate(read(dir+'valibot.cjs'));
const results=[],differences=[];
function compare(label,key,input,fullMessages=false){const a=z.parse(z[key],input),b=v.parse(v[key],input);const aa=norm(a),bb=norm(b);let same=true;try{assert.deepEqual(aa,bb);if(fullMessages)assert.deepEqual(messages(a),messages(b));}catch{same=false;differences.push({label,key,zod:aa,valibot:bb,...(fullMessages?{zodErrors:messages(a),valibotErrors:messages(b)}:{})});}results.push({label,key,same});}
for(const [key,value] of Object.entries(samples)) {compare(key+' accepted',key,value);compare(key+' unknown fields strip',key,{...value,extra:'remove'});compare(key+' empty',key,{});compare(key+' null',key,null);}
for(const image of [undefined,[],[{size:6_000_000,type:'image/png'}],[{size:5_000_000,type:'image/png'}],[{size:5_000_001,type:'image/png'}],[{size:1,type:'image/gif'}],[{size:1,type:'image/png'},{size:1,type:'image/png'}]])compare('product image '+JSON.stringify(image),'productSchema',{...product,image},true);
for(const price of [undefined,null,'1',NaN,Infinity,-Infinity,0,0.01])compare('product price '+String(price),'productSchema',{...product,price},true);
for(const email of ['j@example.com','a+b@example.com','a/b@example.com','a!b@example.com','a@example.c','a@example..com','.a@example.com','a..b@example.com','a@-example.com','a@example-.com','a@localhost','用户@example.com','a@例子.公司','a@exa_mple.com'])compare('email '+email,'userSchema',{...user,email},true);
for(const contactno of ['1','',' ',null,undefined,'bad',Infinity,-Infinity,NaN,true,[],['2'],{},'0x10',Symbol('bad')]){let a,b;try{a=z.parse(z.profileSchema,{...profile,contactno});}catch(e){a={threw:e.name};}try{b=v.parse(v.profileSchema,{...profile,contactno});}catch(e){b={threw:e.name};}const aa=a.threw?a:norm(a),bb=b.threw?b:norm(b);const same=JSON.stringify(aa)===JSON.stringify(bb);results.push({label:'coercion '+String(contactno),same});if(!same)differences.push({label:'coercion '+String(contactno),zod:aa,valibot:bb});}
const job={jobcountry:'US',jobcity:'NY',jobtitle:'Dev',employer:'Sample',startdate:'2026-01-01',enddate:'2026-01-02'};
for(const startdate of ['bad','2026-99-99','2026-1-1'])compare('profile nested date '+startdate,'profileSchema',{...profile,jobs:[{...job,startdate}]},true);
for(const website of ['', 'https://example.com', 'mailto:a@example.com', 'file:///tmp/a', 'custom:hello', 'https://localhost', 'ftp://example.com','bad','http://','https://例子.公司'])compare('website '+website,'demoFormSchema',{...demo,website});
for(const birthDate of [undefined,new Date('2026-01-01'),new Date(NaN),'2026-01-01',null])compare('birthDate '+String(birthDate),'demoFormSchema',{...demo,birthDate});
compare('terms unchecked','demoFormSchema',{...demo,terms:false},true);
compare('dynamic nested member','advancedSchema',{...advanced,members:[{name:'',role:'dev'}]},true);
for(const kind of ['sort','filter'])for(const value of ['bad','null','{}','[]',JSON.stringify(kind==='sort'?[{id:'name',desc:true,extra:1}]:[{id:'name',value:['one','two'],variant:'text',operator:'eq',filterId:'x',extra:1}]),JSON.stringify(kind==='sort'?[{id:'name',desc:'yes'}]:[{id:'name',value:1,variant:'invalid',operator:'invalid',filterId:'x'}])])for(const keys of [undefined,['name'],['other']]){assert.deepEqual(v.tableParse(kind,value,keys),z.tableParse(kind,value,keys));results.push({label:`table ${kind} ${value}`,same:true});}
for(let n=0;n<3;n++)for(const value of [product,{}])assert.deepEqual(norm(z.parse(z.stepSchemas[n],value)),norm(v.parse(v.stepSchemas[n],value)));
for(const name of Object.keys(entry))for(const purpose of ['performance','lifecycle']){const child=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'child',name,purpose],{cwd:root,encoding:'utf8',timeout:120000});assert.equal(child.status,0,child.stderr);}

const {FormApi,FieldApi,revalidateLogic}=require('@tanstack/form-core');
const nativeFormReports={};
for(const [name,api]of Object.entries({zod:z,valibot:v})){
 const submitted=[];
 const values={...profile,jobs:[{...job,startdate:'bad'}]};
 const form=new FormApi({defaultValues:values,validationLogic:revalidateLogic(),validators:{onDynamic:api.profileSchema},onSubmit:({value})=>submitted.push(structuredClone(value))});
 const release=form.mount();const field=new FieldApi({form,name:'jobs[0].startdate'});const releaseField=field.mount();
 await form.handleSubmit();assert.equal(submitted.length,0);assert.equal(field.state.meta.errors[0].message,'开始日期格式应为 YYYY-MM-DD');
 form.setFieldValue('jobs[0].startdate','2026-01-01');await form.handleSubmit();assert.equal(submitted.length,1);assert.equal(submitted[0].contactno,'1');
 form.pushFieldValue('jobs',{...job,startdate:'bad'});await form.handleSubmit();assert.equal(submitted.length,1);assert.equal(form.state.isValid,false);
 form.removeFieldValue('jobs',1);await form.handleSubmit();assert.equal(submitted.length,2);
 const dynamic=new FormApi({defaultValues:{...user,email:'bad'},validationLogic:revalidateLogic(),validators:{onDynamic:api.userSchema},onSubmit:()=>{throw Error('INVALID_DYNAMIC_SUBMITTED');}});const releaseDynamic=dynamic.mount();await dynamic.handleSubmit();assert.equal(dynamic.state.isValid,false);releaseDynamic();
 releaseField();release();nativeFormReports[name]={nestedMessage:true,invalidSubmitBlocked:true,transformedInputPreserved:true,dynamicArray:true,dynamicSchema:true};
}
assert.deepEqual(nativeFormReports.valibot,nativeFormReports.zod);
assert.equal(differences.length,0,'BEHAVIOR_REGRESSION');
assert.equal(JSON.parse(read(dir+'valibot-lifecycle-result.json')).admission,true,'VALIBOT_REFERENCE_RELEASE_FAILED');

const report={nativeFormReports,created:new Date().toISOString(),versions:{zod:JSON.parse(read(require.resolve('zod/package.json'))).version,valibot:JSON.parse(read(dir+'node_modules/valibot/package.json')).version,tanstackForm:JSON.parse(read(require.resolve('@tanstack/form-core/package.json'))).version},businessSource:'Frozen bounded current-source validator fixtures; messages frozen from actual current i18n; native dependency APIs; complete React consumers verified separately on Windows only',compatibility:{cases:results.length,matched:results.filter(x=>x.same).length,differences},sizes,benchmark:Object.fromEntries(Object.keys(entry).map(n=>[n,JSON.parse(read(dir+n+'-performance-result.json'))])),lifecycle:Object.fromEntries(Object.keys(entry).map(n=>[n,JSON.parse(read(dir+n+'-lifecycle-result.json'))])),limits:['No production dependency/lock/source change','No complete React page integration yet','PUBLIC2/Obsidian Host NOT_RUN','Byte counts are not RAM','Default upstream error text / exception object identity not claimed equivalent','Diagnostic WeakRefs do not measure OS working set or native decoded media']};
save('result.json',report);
console.log(JSON.stringify({cases:report.compatibility.cases,matched:report.compatibility.matched,differences:differences.map(x=>x.label),sizes,lifecycle:report.lifecycle},null,2));
