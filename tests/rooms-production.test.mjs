import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRedisClient, redisConfigured, redisNamespace } from '../server-lib/redis.js';
import { assertSameOrigin, clientFingerprint, enforceRateLimit, readToolsJson } from '../server-lib/tools-security.js';
import { PersistentRooms } from '../server-lib/persistent-rooms.js';
import { createRoomsHandler } from '../api/rooms.js';

class FakeRedis {
  constructor(now=()=>Date.now()) { this.now=now;this.data=new Map();this.expiry=new Map();this.calls=[]; }
  value(key) {if(this.expiry.has(key)&&this.expiry.get(key)<=this.now()){this.data.delete(key);this.expiry.delete(key);}return this.data.get(key)??null;}
  async command(command) {
    this.calls.push(command);const [op,...args]=command;
    if(op==='GET')return this.value(args[0]);
    assert.equal(op,'EVAL'); const [script,nkeys,key,...values]=args;assert.equal(Number(nkeys),1);
    if(script.includes('matjib-room-create-v1')){if(this.value(key)!==null)return 0;this.data.set(key,values[0]);this.expiry.set(key,this.now()+Number(values[1]));return 1;}
    if(script.includes('matjib-room-cas-v1')){
      const current=this.value(key);if(current===null)return -1;if(current!==values[0])return 0;
      if(values[1]===''){this.data.delete(key);this.expiry.delete(key);return 1;}
      this.data.set(key,values[1]);this.expiry.set(key,this.now()+Number(values[2]));return 1;
    }
    if(script.includes('matjib-tools-rate-v1')){const count=Number(this.value(key)||0)+1;this.data.set(key,count);if(count===1)this.expiry.set(key,this.now()+Number(values[1])*1000);return[count<=Number(values[0])?1:0,Math.max(0,Number(values[0])-count),Math.ceil((this.expiry.get(key)-this.now())/1000)];}
    throw new Error('Unknown script');
  }
}
const sample = () => ({title:'금요일 저녁',nickname:'방장',candidates:[{name:'식당 A',menu:'국수',address:'서울'},{name:'식당 B',menu:'덮밥',address:'서울'}]});
const status = n => e => e.status===n;
const req = (method='POST',query={},body=sample(),headers={}) => ({method,query,body,headers:{host:'example.vercel.app',origin:'https://example.vercel.app','content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}});
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}

test('Redis configuration accepts either complete credential pair and isolates environments',()=>{
  assert.equal(redisConfigured({}),false);assert.equal(redisConfigured({KV_REST_API_URL:'https://db.example',UPSTASH_REDIS_REST_TOKEN:'secret'}),false);
  assert.equal(redisConfigured({KV_REST_API_URL:'https://db.example',KV_REST_API_TOKEN:'secret'}),true);
  assert.equal(redisConfigured({UPSTASH_REDIS_REST_URL:'https://db.example',UPSTASH_REDIS_REST_TOKEN:'secret'}),true);
  assert.equal(redisConfigured({KV_REST_API_URL:'http://db.example',KV_REST_API_TOKEN:'secret'}),false);
  assert.notEqual(redisNamespace({VERCEL_ENV:'production'}),redisNamespace({VERCEL_ENV:'preview'}));
});
test('Redis REST unwraps values and never leaks credentials/provider error details',async()=>{
  let sent;const env={KV_REST_API_URL:'https://db.example',KV_REST_API_TOKEN:'very-secret'};
  const client=createRedisClient({env,fetchImpl:async(url,options)=>{sent={url,options};return{ok:true,json:async()=>({result:'ok'})};}});
  assert.equal(await client.command(['GET','key']),'ok');assert.equal(sent.options.headers.Authorization,'Bearer very-secret');
  const broken=createRedisClient({env,fetchImpl:async()=>({ok:true,json:async()=>({error:'very-secret leaked upstream'})})});
  await assert.rejects(broken.command(['GET','key']),e=>e.status===503&&!e.message.includes('very-secret'));
  await assert.rejects(createRedisClient({env:{}}).command(['GET','key']),status(503));
});
test('room persistence stores SHA256 hashes only, survives a new handler/store instance',async()=>{
  const redis=new FakeRedis(),rooms=new PersistentRooms({redis,env:{VERCEL_ENV:'production'}}),host=await rooms.create(sample());
  const raw=redis.data.get(rooms.key(host.room.id));assert.ok(!raw.includes(host.memberToken));
  assert.ok(raw.includes(createHash('sha256').update(host.memberToken).digest('hex')));assert.ok(!raw.includes('"token":'));
  const reload=new PersistentRooms({redis,env:{VERCEL_ENV:'production'}});assert.deepEqual(await reload.get(host.room.id,host.memberToken),host.room);
  assert.ok(!JSON.stringify(host.room).includes('tokenHash'));
  const preview=new PersistentRooms({redis,env:{VERCEL_ENV:'preview'}});await assert.rejects(preview.get(host.room.id,host.memberToken),status(404));
});
test('concurrent duplicate joins and capacity checks are atomic',async()=>{
  const redis=new FakeRedis(),rooms=new PersistentRooms({redis}),host=await rooms.create(sample());
  const duplicates=await Promise.allSettled([rooms.join(host.room.id,{nickname:'손님'}),rooms.join(host.room.id,{nickname:'손님'})]);
  assert.equal(duplicates.filter(x=>x.status==='fulfilled').length,1);assert.equal(duplicates.find(x=>x.status==='rejected').reason.status,409);
  for(const nickname of ['둘','셋','넷'])await rooms.join(host.room.id,{nickname});
  const capacity=await Promise.allSettled([rooms.join(host.room.id,{nickname:'다섯'}),rooms.join(host.room.id,{nickname:'여섯'})]);
  assert.equal(capacity.filter(x=>x.status==='fulfilled').length,1);assert.equal((await rooms.get(host.room.id,host.memberToken)).members.length,6);
});
test('concurrent votes do not lose other members updates and final decision stays immutable',async()=>{
  const redis=new FakeRedis(),rooms=new PersistentRooms({redis}),host=await rooms.create(sample()),guest=await rooms.join(host.room.id,{nickname:'친구'}),cid=host.room.candidates[0].id;
  await Promise.all([rooms.vote(host.room.id,host.memberToken,{candidateId:cid,value:'like'}),rooms.vote(host.room.id,guest.memberToken,{candidateId:cid,value:'okay'})]);
  const room=await rooms.get(host.room.id,host.memberToken);assert.equal(Object.keys(room.votes).length,2);
  await rooms.decide(host.room.id,host.memberToken,{candidateId:cid});
  await assert.rejects(rooms.decide(host.room.id,host.memberToken,{candidateId:cid}),status(409));
  await assert.rejects(rooms.join(host.room.id,{nickname:'추가'}),status(409));
});
test('joining concurrently with decision cannot add an unconsenting member to a finalized room',async()=>{
  for(let i=0;i<2;i++){
    const redis=new FakeRedis(),rooms=new PersistentRooms({redis}),host=await rooms.create(sample()),cid=host.room.candidates[0].id;
    await rooms.vote(host.room.id,host.memberToken,{candidateId:cid,value:'like'});
    const actions=i?[()=>rooms.join(host.room.id,{nickname:'새 사람'}),()=>rooms.decide(host.room.id,host.memberToken,{candidateId:cid})]:[()=>rooms.decide(host.room.id,host.memberToken,{candidateId:cid}),()=>rooms.join(host.room.id,{nickname:'새 사람'})];
    const results=await Promise.allSettled(actions.map(f=>f()));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const room=await rooms.get(host.room.id,host.memberToken);
    assert.ok(!room.decision||room.members.every(m=>['like','okay'].includes(room.votes[m.id]?.[room.decision])));
  }
});
test('TTL does not extend on votes; unauthorized deletes and cross-room tokens are rejected',async()=>{
  let now=Date.now();const redis=new FakeRedis(()=>now),rooms=new PersistentRooms({redis,now:()=>now}),host=await rooms.create(sample()),guest=await rooms.join(host.room.id,{nickname:'손님'});
  const expiry=redis.expiry.get(rooms.key(host.room.id));now+=1000;
  await rooms.vote(host.room.id,guest.memberToken,{candidateId:host.room.candidates[0].id,value:'like'});assert.equal(redis.expiry.get(rooms.key(host.room.id)),expiry);
  await assert.rejects(rooms.delete(host.room.id,guest.memberToken),status(403));
  const other=await rooms.create(sample());await assert.rejects(rooms.get(host.room.id,other.memberToken),status(401));
  now=expiry+1;await assert.rejects(rooms.get(host.room.id,host.memberToken),status(404));
});
test('atomic rate limits expire and origin/body/fingerprint checks fail closed',async()=>{
  let now=Date.now();const redis=new FakeRedis(()=>now);
  await enforceRateLimit(redis,{key:'limit',limit:1,windowSeconds:60});await assert.rejects(enforceRateLimit(redis,{key:'limit',limit:1,windowSeconds:60}),status(429));
  now+=61000;await enforceRateLimit(redis,{key:'limit',limit:1,windowSeconds:60});
  assert.throws(()=>assertSameOrigin(req('POST',{},null,{origin:'https://evil.example'})),status(403));
  assert.throws(()=>assertSameOrigin({...req(),headers:{host:'example.vercel.app'}}),status(403));
  await assert.rejects(readToolsJson(req('POST',{}, {a:'가'.repeat(10000)})),status(413));
  await assert.rejects(readToolsJson(req('POST',{}, {}, {'content-type':'text/plain'})),status(415));
  assert.equal(clientFingerprint(req(),{}),clientFingerprint(req('POST',{},null,{'x-forwarded-for':'attacker-selected'}),{}));
  assert.notEqual(clientFingerprint(req('POST',{},null,{'x-vercel-forwarded-for':'1.1.1.1'}),{VERCEL:'1'}),clientFingerprint(req('POST',{},null,{'x-vercel-forwarded-for':'2.2.2.2'}),{VERCEL:'1'}));
});
test('rooms API reports unconfigured state and does not fall back to ephemeral memory',async()=>{
  const handler=createRoomsHandler({env:{}}),state=response();await handler(req('GET',{action:'status'},undefined),state);assert.equal(state.body.storage,'unconfigured');
  const create=response();await handler(req(),create);assert.equal(create.statusCode,503);
});
test('rooms API implements authenticated round trip, size checks, origin protection and no-cache',async()=>{
  const redis=new FakeRedis(),handler=createRoomsHandler({env:{VERCEL_ENV:'preview',APP_ACCESS_KEY:'access'},redis}),headers={'x-imm-key':'access'};
  const unauthorized=response();await handler(req(),unauthorized);assert.equal(unauthorized.statusCode,401);assert.equal(redis.calls.length,0);
  const foreign=response();await handler(req('POST',{},sample(),{...headers,origin:'https://evil.example'}),foreign);assert.equal(foreign.statusCode,403);
  const large=response();await handler(req('POST',{}, {title:'a'.repeat(25000)},headers),large);assert.equal(large.statusCode,413);assert.equal(redis.calls.length,0);
  const made=response();await handler(req('POST',{},sample(),headers),made);assert.equal(made.statusCode,201);assert.match(made.headers['Cache-Control'],/no-store/);
  const {room,memberToken}=made.body,get=response();await handler(req('GET',{id:room.id},undefined,{...headers,authorization:`Bearer ${memberToken}`}),get);assert.equal(get.statusCode,200);assert.equal(get.body.id,room.id);
  const removed=response();await handler(req('DELETE',{id:room.id},undefined,{...headers,authorization:`Bearer ${memberToken}`}),removed);assert.equal(removed.body.deleted,true);
});
