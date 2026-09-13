import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMenuPhoto,expandMenuTuples} from './menu-api.mjs';
import {MENU_ANALYSIS_TIMEOUT_MS,MENU_MAX_OUTPUT_TOKENS} from './menu-analysis-policy.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const tuple=['소바','そば',850,'m',null];
const page=(pageNumber,items=[tuple],currency='JPY')=>({page:pageNumber,currency,items,warnings:[]});
const response=pages=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({pages})}]})});

test('compact tuples expand to the existing public schema without changing unknowns',()=>{
  const [result]=expandMenuTuples([page(1)]);
  assert.deepEqual(result.items[0],{name:'소바',localName:'そば',price:850,category:'main',spicy:null});
  for(const [code,category]of [['m','main'],['s','side'],['d','drink'],['u','unknown']])assert.equal(expandMenuTuples([page(1,[['요리','Dish',null,code,false]])])[0].items[0].category,category);
});

test('invalid tuple length, field types and values fail closed',()=>{
  const invalid=[tuple.slice(0,4),[...tuple,'extra'],[null,'そば',850,'m',null],['소바',5,850,'m',null],['','',850,'m',null],['소바','そば','850','m',null],['소바','そば',-1,'m',null],['소바','そば',Infinity,'m',null],['소바','そば',850,'main',null],['소바','そば',850,'__proto__',null],['소바','そば',850,'m','false'],null,'text'];
  for(const item of invalid)assert.throws(()=>expandMenuTuples([page(1,[item])]),error=>error.status===502&&error.code==='MENU_OUTPUT_FORMAT');
});

test('legacy object responses remain compatible',async()=>{
  const object={name:'소바',localName:'そば',price:850,category:'main',spicy:null};
  assert.deepEqual(expandMenuTuples([page(1,[object])])[0].items[0],object);
  const result=await parseMenuPhoto({image:png},{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({currency:'JPY',items:[object]})}]})})});
  assert.equal(result.items[0].price,850);assert.deepEqual(result.items[0].sourcePages,[1]);
});

test('four photos with sixty compact items use one Haiku call and unchanged output ceiling',async()=>{
  let calls=0;const pages=Array.from({length:4},(_,p)=>page(p+1,Array.from({length:15},(_,i)=>[`메뉴 ${p+1}-${i+1}`,`Dish ${p+1}-${i+1}`,i+1,'m',null]),'USD'));
  const result=await parseMenuPhoto({images:Array(4).fill(png)},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'claude-haiku-4-5');assert.equal(payload.max_tokens,MENU_MAX_OUTPUT_TOKENS);assert.equal(payload.max_tokens,6000);assert.equal(payload.messages[0].content.filter(b=>b.type==='image').length,4);assert.match(payload.system,/exactly five entries/);return response(pages);
  }});
  assert.equal(calls,1);assert.equal(result.items.length,60);for(let p=1;p<=4;p++)assert.equal(result.items.filter(item=>item.sourcePages.includes(p)).length,15);
});

test('compact duplicate prices, unknown prices and currencies stay conservative',async()=>{
  const result=await parseMenuPhoto({images:[png,png,png]},{apiKey:'test',fetchImpl:async()=>response([page(1),page(2,[['소바','そば',950,'m',null]]),page(3,[['소바','そば',null,'m',null]])])});
  assert.equal(result.items.length,1);assert.equal(result.items[0].price,null);assert.equal(result.items[0].priceConflict,true);assert.deepEqual(result.items[0].sourcePages,[1,2,3]);assert.deepEqual(result.items[0].priceOptions.map(option=>option.price),[850,950,null]);
  const currencies=await parseMenuPhoto({images:[png,png]},{apiKey:'test',fetchImpl:async()=>response([page(1),page(2,[tuple],'USD')])});assert.equal(currencies.currency,null);assert.equal(currencies.items[0].price,null);assert.equal(currencies.items[0].priceOptions.length,2);
});

test('compact output still validates page provenance and warns on missing pages',async()=>{
  await assert.rejects(parseMenuPhoto({images:[png,png]},{apiKey:'test',fetchImpl:async()=>response([page(3)])}),error=>error.status===502);
  const partial=await parseMenuPhoto({images:[png,png]},{apiKey:'test',fetchImpl:async()=>response([page(1)])});assert.deepEqual(partial.items[0].sourcePages,[1]);assert.ok(partial.warnings.some(w=>w.includes('2번 사진')));
});

test('analysis can pass the old 35-second cutoff and complete without another call',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;let aborted=false;
  const pending=parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;return new Promise((resolve,reject)=>{setTimeout(()=>resolve(response([page(1)])),40000);options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));});});
  }});
  t.mock.timers.tick(35001);assert.equal(aborted,false);t.mock.timers.tick(4999);
  const result=await pending;assert.equal(result.items[0].price,850);assert.equal(calls,1);assert.equal(aborted,false);
});

test('analysis aborts at 120 seconds with a specific code and photo-preservation guidance',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;let aborted=false;
  const pending=parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));});});
  }});
  const rejection=assert.rejects(pending,error=>error.status===504&&error.code==='MENU_ANALYSIS_TIMEOUT'&&error.message.includes('사진은 그대로 유지'));
  t.mock.timers.tick(MENU_ANALYSIS_TIMEOUT_MS-1);assert.equal(aborted,false);t.mock.timers.tick(1);await rejection;assert.equal(calls,1);assert.equal(aborted,true);
});

test('explicit shorter timeouts are honored and longer ones are capped',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const fetchImpl=async(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});
  const short=parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl,timeoutMs:45000});const shortRejection=assert.rejects(short,error=>error.code==='MENU_ANALYSIS_TIMEOUT');t.mock.timers.tick(45000);await shortRejection;
  const long=parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl,timeoutMs:999999});const longRejection=assert.rejects(long,error=>error.code==='MENU_ANALYSIS_TIMEOUT');t.mock.timers.tick(MENU_ANALYSIS_TIMEOUT_MS);await longRejection;
});

test('truncated compact output is still rejected after usage observation',async()=>{
  let calls=0;let usage;
  await assert.rejects(parseMenuPhoto({images:[png]},{apiKey:'test',onUsage:value=>{usage=value;},fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({stop_reason:'max_tokens',usage:{input_tokens:1000,output_tokens:6000},content:[{type:'text',text:'{"pages":['}]})};}}),error=>error.status===502);
  assert.equal(calls,1);assert.equal(usage.output_tokens,6000);
});
