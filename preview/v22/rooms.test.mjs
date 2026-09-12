import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomStore } from './room-store.mjs';
const sample = () => ({ title: '친구 점심', nickname: '방장', candidates: [{name:'예시 식당 A',menu:'국수'}, {name:'예시 식당 B',menu:'덮밥'}] });
const errorStatus = (status) => e => e.status === status;
test('create returns safe public room and opaque session credential', () => {
  const s = new RoomStore(), {room,memberToken} = s.create(sample());
  assert.match(room.id, /^[a-f0-9]{48}$/); assert.match(memberToken, /^[a-f0-9]{48}$/);
  assert.equal(room.members.length,1); assert.equal(room.decision,null);
  assert.ok(!JSON.stringify(room).includes(memberToken));
  assert.throws(() => s.get(room.id), errorStatus(401));
});
test('joining, votes and all-member consent work without fake votes', () => {
  const s = new RoomStore(), host = s.create(sample()), guest = s.join(host.room.id,{nickname:'친구'}), cid = host.room.candidates[0].id;
  assert.equal(Object.keys(guest.room.votes).length,0);
  s.vote(host.room.id,host.memberToken,{candidateId:cid,value:'like'});
  assert.throws(() => s.decide(host.room.id,host.memberToken,{candidateId:cid}), errorStatus(409));
  s.vote(host.room.id,guest.memberToken,{candidateId:cid,value:'no'});
  assert.throws(() => s.decide(host.room.id,host.memberToken,{candidateId:cid}), errorStatus(409));
  s.vote(host.room.id,guest.memberToken,{candidateId:cid,value:'okay'});
  assert.throws(() => s.decide(host.room.id,guest.memberToken,{candidateId:cid}), errorStatus(403));
  assert.equal(s.decide(host.room.id,host.memberToken,{candidateId:cid}).decision,cid);
  assert.throws(() => s.decide(host.room.id,host.memberToken,{candidateId:cid}), errorStatus(409));
  assert.throws(() => s.join(host.room.id,{nickname:'추가'}), errorStatus(409));
  assert.throws(() => s.vote(host.room.id,guest.memberToken,{candidateId:cid,value:'like'}), errorStatus(409));
});
test('membership credentials cannot cross room boundaries', () => {
  const s = new RoomStore(), a = s.create(sample()), b = s.create(sample());
  assert.throws(() => s.get(a.room.id,b.memberToken),errorStatus(401));
  assert.throws(() => s.vote(a.room.id,b.memberToken,{candidateId:a.room.candidates[0].id,value:'like'}),errorStatus(401));
});
test('validation prevents duplicate people, duplicate candidates and invalid votes', () => {
  const s = new RoomStore();
  assert.throws(() => s.create({...sample(),candidates:[{name:'A'},{name:'A'}]}),errorStatus(400));
  assert.throws(() => s.create({...sample(),title:'x'.repeat(61)}),errorStatus(400));
  const h = s.create(sample());
  assert.throws(() => s.join(h.room.id,{nickname:'방장'}),errorStatus(409));
  assert.throws(() => s.vote(h.room.id,h.memberToken,{candidateId:h.room.candidates[0].id,value:'fake'}),errorStatus(400));
  assert.throws(() => s.vote(h.room.id,h.memberToken,{candidateId:'missing',value:'like'}),errorStatus(400));
});
test('limit is six actual members, expiry and deletion clean up', () => {
  let now = Date.now(); const s = new RoomStore({now:()=>now,ttlMs:1000}), h = s.create(sample());
  for(let i=0;i<5;i++) s.join(h.room.id,{nickname:`친구${i}`});
  assert.throws(() => s.join(h.room.id,{nickname:'정원초과'}),errorStatus(409));
  now += 1001; assert.throws(() => s.get(h.room.id,h.memberToken),errorStatus(410));
  assert.equal(s.rooms.size,0);
  const h2 = s.create(sample()), g = s.join(h2.room.id,{nickname:'손님'});
  assert.throws(() => s.delete(h2.room.id,g.memberToken),errorStatus(403));
  assert.deepEqual(s.delete(h2.room.id,h2.memberToken),{deleted:true});
  assert.throws(() => s.get(h2.room.id,h2.memberToken),errorStatus(404));
});
test('public objects cannot mutate stored room', () => {
  const s = new RoomStore(), h = s.create(sample()); h.room.candidates[0].name='changed'; h.room.members.push({id:'fake',nickname:'fake'});
  const fresh = s.get(h.room.id,h.memberToken); assert.equal(fresh.candidates[0].name,'예시 식당 A'); assert.equal(fresh.members.length,1);
});
test('bounded room count and valid future dates', () => {
  const s = new RoomStore({maxRooms:1}); s.create(sample()); assert.throws(() => s.create(sample()),errorStatus(429));
  const d = new RoomStore(); assert.throws(() => d.create({...sample(),meetingAt:'not-date'}),errorStatus(400));
  assert.throws(() => d.create({...sample(),meetingAt:new Date(Date.now()-86400000).toISOString()}),errorStatus(400));
});
test('null payloads are user errors and never internal exceptions', () => {
  const s=new RoomStore();assert.throws(()=>s.create(null),errorStatus(400));
  const h=s.create(sample());
  assert.throws(()=>s.join(h.room.id,null),errorStatus(400));
  assert.throws(()=>s.vote(h.room.id,h.memberToken,null),errorStatus(400));
  assert.throws(()=>s.decide(h.room.id,h.memberToken,null),errorStatus(400));
});
test('confirmation flows use accessible in-page dialogs, not native modal prompts', () => {
  const source=readFileSync(new URL('./rooms.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:window\s*\.\s*)?confirm\s*\(/);
  assert.match(source,/role="alertdialog"/);assert.match(source,/aria-modal="true"/);
  assert.match(source,/data-confirm-cancel/);assert.match(source,/data-confirm-accept/);
  assert.match(source,/askConfirmation\([\s\S]*?'식당 확정'/);
  assert.match(source,/askConfirmation\([\s\S]*?'모임 삭제'/);
  assert.match(source,/askConfirmation\([\s\S]*?'새 모임 만들기'/);
});
