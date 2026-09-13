import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuPhotoHandler,validateProductionMenuPhotos} from '../api/menu-photo.js';
import {parseMenuPhoto} from '../preview/v22/menu-api.mjs';
import {MENU_ANALYSIS_TIMEOUT_MS} from '../preview/v22/menu-analysis-policy.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const env={ANTHROPIC_API_KEY:'mock-anthropic-key',KV_REST_API_URL:'https://example.upstash.io',KV_REST_API_TOKEN:'mock-redis-token',VERCEL:'1'};
const parsed={currency:'JPY',items:[{id:'one',name:'메밀국수',localName:'そば',price:850,category:'main',spicy:null,description:'메밀로 만든 일본식 국수',descriptionSource:'general'}],warnings:[]};
function req(body={images:[png]},method='POST',extraHeaders={}){return {method,body,headers:{host:'matjib.test',origin:'https://matjib.test','content-type':'application/json','x-vercel-forwarded-for':'192.0.2.1',...extraHeaders},socket:{remoteAddress:'127.0.0.1'}};}
function res(){return {headers:{},statusCode:200,body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function harness(options={}){
  const counts=new Map();const commands=[];const events=[];let parseCalls=0;
  const redis={async command(command){commands.push(command);const key=command[3];if(options.redisError)throw Object.assign(new Error('저장소 연결 실패'),{status:503});if(command[1].includes('tools-rate-v1'))return options.rateDenied?[0,0,55]:[1,2,60];if(command[1].includes('menu-reserve-v1')){const count=counts.get(key)||options.initialUsed||0;if(count>=Number(command[4]))return [0,count];counts.set(key,count+1);return [1,count+1];}if(options.statsError)throw new Error('stats down');return 1;}};
  const handler=createMenuPhotoHandler({env:{...env,...options.env},createRedis:()=>redis,accessGuard:options.accessGuard||(()=>true),now:()=>new Date('2026-09-13T00:00:00Z'),...(options.clock?{clock:options.clock}:{}),logEvent:event=>events.push(event),parsePhoto:async(body,config)=>{parseCalls++;config.onUsage({input_tokens:1234,output_tokens:123});if(options.parseError)throw Object.assign(new Error('분석 결과를 읽지 못했습니다.'),{status:options.parseErrorStatus||502,code:options.parseErrorCode});assert.equal(config.model,'claude-haiku-4-5');assert.ok(config.timeoutMs>35000&&config.timeoutMs<=MENU_ANALYSIS_TIMEOUT_MS);return structuredClone(parsed);}});
  return {handler,counts,commands,events,get parseCalls(){return parseCalls;}};
}
async function run(harness,request=req()){const response=res();await harness.handler(request,response);return response;}

test('status reveals capability and monthly policy without using Redis or AI',async()=>{
  const h=harness();const response=await run(h,req(undefined,'GET'));
  assert.equal(response.statusCode,200);assert.equal(response.body.menuVisionConfigured,true);assert.equal(response.body.menuMonthlyLimit,20);assert.equal(h.commands.length,0);assert.equal(h.parseCalls,0);
  assert.equal(JSON.stringify(response.body).includes('mock-redis-token'),false);
  assert.equal(response.body.menuAnalysisVersion,24);assert.equal(response.body.menuMeaningEnabled,true);assert.equal(response.body.menuAnalysisTimeoutSeconds,120);
});
test('four valid photos still reserve only one analysis with longer model deadline',async()=>{
  const h=harness();const response=await run(h,req({images:[png,png,png,png]}));
  assert.equal(response.statusCode,200);assert.equal(h.parseCalls,1);assert.equal(response.body.quota.remaining,19);
  assert.equal(response.headers['x-menu-analysis-version'],'24');
  assert.deepEqual(Object.keys(h.events[0]).sort(),['durationMs','phase','photoCount','status','version']);
  assert.equal(h.events[0].photoCount,4);assert.equal(h.events[0].phase,'complete');
  assert.equal(JSON.stringify(h.events).includes('mock-'),false);
});
test('model timeout has a specific code and cannot trigger an automatic paid retry',async()=>{
  const h=harness({parseError:true,parseErrorStatus:504,parseErrorCode:'MENU_ANALYSIS_TIMEOUT'});const response=await run(h);
  assert.equal(response.statusCode,504);assert.equal(response.body.code,'MENU_ANALYSIS_TIMEOUT');assert.equal(h.parseCalls,1);
  assert.equal([...h.counts.values()][0],1);assert.equal(h.events[0].phase,'analysis');
});
test('expired preparation deadline stops before monthly reservation or paid work',async()=>{
  let calls=0;const h=harness({clock:()=>calls++===0?0:116000});const response=await run(h);
  assert.equal(response.statusCode,504);assert.equal(response.body.code,'MENU_PREPARATION_TIMEOUT');
  assert.equal(h.parseCalls,0);assert.equal(h.counts.size,0);assert.equal(h.commands.length,1);
});
test('valid request reserves quota then performs exactly one paid call and records usage',async()=>{
  const h=harness();const response=await run(h);
  assert.equal(response.body.items[0].description,'메밀로 만든 일본식 국수');assert.equal(response.body.items[0].descriptionSource,'general');
  assert.equal(response.statusCode,200);assert.equal(h.parseCalls,1);assert.equal(response.body.quota.remaining,19);assert.equal(response.body.quota.limit,20);
  assert.ok(h.commands[0][1].includes('tools-rate-v1'));assert.ok(h.commands[1][1].includes('menu-reserve-v1'));assert.ok(h.commands[2][1].includes('menu-usage-v1'));
  assert.equal(h.commands[0][3].includes('192.0.2.1'),false);assert.ok(response.headers['cache-control'].includes('no-store'));
});
test('malformed body, image, dimensions, and size do not consume reservations or call AI',async()=>{
  const hugePng=Buffer.from(png.split(',')[1],'base64');hugePng.writeUInt32BE(4000,16);
  for(const body of [{images:[]},{images:['https://example.test/x.jpg']},{images:[`data:image/png;base64,${hugePng.toString('base64')}`]},{images:[png],unused:'x'.repeat(4200000)}]){
    const h=harness();const response=await run(h,req(body));assert.ok([400,413].includes(response.statusCode));assert.equal(h.commands.length,0);assert.equal(h.parseCalls,0);
  }
  assert.throws(()=>validateProductionMenuPhotos({images:['data:image/png;base64,aGVsbG8=']}));
});
test('cross-origin, absent-origin and optional access guard block before paid work',async()=>{
  for(const headers of [{origin:'https://evil.test'},{origin:undefined},{'sec-fetch-site':'cross-site'}]){const h=harness();const response=await run(h,req({images:[png]},'POST',headers));assert.equal(response.statusCode,403);assert.equal(h.parseCalls,0);assert.equal(h.commands.length,0);}
  const h=harness({accessGuard:(request,response)=>{response.status(401).json({error:'접근 코드가 필요합니다.'});return false;}});assert.equal((await run(h)).statusCode,401);assert.equal(h.parseCalls,0);
});
test('missing storage/key, disabled flag, and non-Haiku configuration all fail closed',async()=>{
  for(const config of [{KV_REST_API_TOKEN:''},{ANTHROPIC_API_KEY:''},{MENU_PHOTO_ENABLED:'0'},{ANTHROPIC_MODEL:'claude-sonnet-4-5'},{MENU_MONTHLY_LIMIT:'999'}]){const h=harness({env:config});assert.equal((await run(h)).statusCode,503);assert.equal(h.commands.length,0);assert.equal(h.parseCalls,0);assert.equal((await run(h,req(undefined,'GET'))).body.menuVisionConfigured,false);}
});
test('rate limit, global monthly limit and Redis outage prevent AI calls',async()=>{
  const limited=harness({rateDenied:true});const rate=await run(limited);assert.equal(rate.statusCode,429);assert.equal(rate.headers['retry-after'],'55');assert.equal(limited.commands.length,1);assert.equal(limited.parseCalls,0);
  const monthly=harness({initialUsed:20});const full=await run(monthly);assert.equal(full.statusCode,429);assert.equal(full.body.code,'MENU_MONTHLY_LIMIT');assert.equal(monthly.parseCalls,0);
  const offline=harness({redisError:true});assert.equal((await run(offline)).statusCode,503);assert.equal(offline.parseCalls,0);
});
test('paid failures keep their reservations; statistics failure never turns success into failure',async()=>{
  const failed=harness({parseError:true});assert.equal((await run(failed)).statusCode,502);assert.equal([...failed.counts.values()][0],1);assert.equal(failed.parseCalls,1);assert.ok(failed.commands.some(c=>c[1].includes('menu-usage-v1')));
  const stat=harness({statsError:true});assert.equal((await run(stat)).statusCode,200);assert.equal([...stat.counts.values()][0],1);assert.equal(stat.parseCalls,1);
});
test('production and preview handlers use the same global quota key',async()=>{
  const prod=harness({env:{VERCEL_ENV:'production'}});const preview=harness({env:{VERCEL_ENV:'preview'}});await run(prod);await run(preview);assert.equal(prod.commands[1][3],preview.commands[1][3]);
});
test('usage observer sees paid truncated outputs and does not alter public OCR data',async()=>{
  let observed;
  await assert.rejects(parseMenuPhoto({images:[png]},{apiKey:'mock',onUsage:usage=>{observed=usage;},fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',usage:{input_tokens:42,output_tokens:6000},content:[]})})}),e=>e.status===502);
  assert.deepEqual(observed,{input_tokens:42,output_tokens:6000});
  const result=await parseMenuPhoto({images:[png]},{apiKey:'mock',onUsage:()=>{throw new Error('observer failed');},fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text:JSON.stringify({pages:[{page:1,currency:'JPY',items:parsed.items}]})}]})})});assert.equal(result.items[0].price,850);assert.equal(result.usage,undefined);
});
