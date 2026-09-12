import test from 'node:test';
import assert from 'node:assert/strict';
import {menuMonthlyLimit,menuQuotaPeriod,reserveMenuQuota,recordMenuUsage,sanitizedMenuUsage} from '../server-lib/menu-quota.js';

function redisFake(){const counts=new Map();const commands=[];return {counts,commands,async command(command){commands.push(command);const key=command[3];if(command[1].includes('reserve-v1')){const limit=Number(command[4]);const used=counts.get(key)||0;if(used>=limit)return [0,used];counts.set(key,used+1);return [1,used+1];}return 1;}};}

test('photo quota defaults to 20 and accepts only an explicit bounded 0..100 setting',()=>{
  assert.equal(menuMonthlyLimit({}),20);assert.equal(menuMonthlyLimit({MENU_MONTHLY_LIMIT:'0'}),0);assert.equal(menuMonthlyLimit({MENU_MONTHLY_LIMIT:'100'}),100);
  for(const value of ['101','-1','20.1','NaN','Infinity','1e2',20,'1000'])assert.throws(()=>menuMonthlyLimit({MENU_MONTHLY_LIMIT:value}));
});
test('monthly quota uses UTC month with a retained expiry and shared project namespace',()=>{
  const info=menuQuotaPeriod(new Date('2026-09-30T23:59:59.000Z'));
  assert.equal(info.month,'2026-09');assert.equal(info.resetsAt,'2026-10-01T00:00:00.000Z');assert.equal(info.ttl,7*86400+1);assert.ok(info.key.startsWith('matjib:v22:menu:global:'));
  assert.equal(menuQuotaPeriod(new Date('2026-10-01T00:00:00Z')).month,'2026-10');assert.throws(()=>menuQuotaPeriod('not a date'));
});
test('atomic reservation admits at most 20 concurrent attempts and does not increment denied ones',async()=>{
  const redis=redisFake();const now=new Date('2026-09-13T00:00:00Z');
  const outcomes=await Promise.allSettled(Array.from({length:40},()=>reserveMenuQuota(redis,{now})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,20);assert.equal([...redis.counts.values()][0],20);
  assert.ok(outcomes.filter(r=>r.status==='rejected').every(r=>r.reason.status===429&&r.reason.code==='MENU_MONTHLY_LIMIT'));
  const script=redis.commands[0][1];assert.ok(script.indexOf('current >= limit')<script.indexOf("redis.call('INCR'"));
  assert.ok(script.includes("redis.call('EXPIRE'"));assert.equal(redis.commands[0][0],'EVAL');
});
test('preview and production cannot split the project monthly budget',async()=>{
  const redis=redisFake();const now=new Date('2026-09-13T00:00:00Z');
  await reserveMenuQuota(redis,{limit:1,now,environment:'preview'});
  await assert.rejects(reserveMenuQuota(redis,{limit:1,now,environment:'production'}),e=>e.status===429);assert.equal(redis.counts.size,1);
});
test('Redis failures and malformed reservation replies fail closed',async()=>{
  for(const value of [null,[1],['yes',1],[true,1],[1,-1],[1,500],[0,'bad']])await assert.rejects(reserveMenuQuota({command:async()=>value}),e=>e.status===503);
  await assert.rejects(reserveMenuQuota({command:async()=>{throw Object.assign(new Error('unavailable'),{status:503});}}),e=>e.status===503);
});
test('usage recording contains only bounded token statistics and never photo data',async()=>{
  const redis=redisFake();const reservation=await reserveMenuQuota(redis);
  assert.equal(await recordMenuUsage(redis,reservation,{input_tokens:4500,output_tokens:1500,image:'secret photo'}),true);
  const command=redis.commands.at(-1);assert.ok(command[1].includes('usage-v1'));assert.deepEqual(command.slice(4,8),[4500,1500,0,0]);assert.equal(JSON.stringify(command).includes('secret photo'),false);
  assert.equal(sanitizedMenuUsage({input_tokens:-1,output_tokens:0}),null);assert.equal(sanitizedMenuUsage({input_tokens:'1',output_tokens:2}),null);
  assert.equal(sanitizedMenuUsage({}),null);
  assert.equal(await recordMenuUsage({command:async()=>{throw new Error('statistics offline');}},reservation,{input_tokens:1,output_tokens:2}),false);
});
