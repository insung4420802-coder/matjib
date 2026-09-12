import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewServer } from './server.mjs';

async function fixture(fn) {
  const server = createPreviewServer({ apiKey: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const data = {title:'저녁 모임',nickname:'방장',candidates:[{name:'가상 A'},{name:'가상 B'}]};
const post = (base, path, body, token) => fetch(base + '/preview-api' + path, {method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});

test('preview status is explicit, secrets/backend files cannot be served', async () => fixture(async base => {
  const status = await (await fetch(base + '/preview-api/status')).json();
  assert.equal(status.previewOnly, true); assert.equal(status.menuVisionConfigured, false);
  assert.equal(status.roomStorage, 'local-memory');
  for (const path of ['/preview/v22/server.mjs','/preview/v22/menu-api.mjs','/.env','/index.html','/preview/v22/../../.git/config']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  const home = await fetch(base + '/preview/v22/');
  assert.equal(home.status, 200); assert.match(await home.text(), /로컬 미리보기/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
}));

test('room integration: create, private read, join, vote, unanimous decision, delete', async () => fixture(async base => {
  const created = await (await post(base, '/rooms', data)).json();
  const {room,memberToken} = created;
  assert.equal(room.members.length, 1);
  assert.equal((await fetch(`${base}/preview-api/rooms/${room.id}`)).status,401);
  const guest = await (await post(base, `/rooms/${room.id}/join`, {nickname:'친구'})).json();
  const candidateId=room.candidates[0].id;
  assert.equal((await post(base, `/rooms/${room.id}/votes`,{candidateId,value:'like'},memberToken)).status,200);
  assert.equal((await post(base, `/rooms/${room.id}/decision`,{candidateId},memberToken)).status,409);
  assert.equal((await post(base, `/rooms/${room.id}/votes`,{candidateId,value:'okay'},guest.memberToken)).status,200);
  assert.equal((await post(base, `/rooms/${room.id}/decision`,{candidateId},guest.memberToken)).status,403);
  const decided = await (await post(base, `/rooms/${room.id}/decision`,{candidateId},memberToken)).json();
  assert.equal(decided.decision,candidateId);
  assert.equal((await fetch(`${base}/preview-api/rooms/${room.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${memberToken}`}})).status,200);
  assert.equal((await fetch(`${base}/preview-api/rooms/${room.id}`,{headers:{Authorization:`Bearer ${memberToken}`}})).status,404);
}));

test('no API key means no false photo analysis or upstream request', async () => fixture(async base => {
  const result=await post(base,'/menu-parse',{image:'data:image/png;base64,aGVsbG8='});
  assert.equal(result.status,503); assert.match((await result.json()).error,/아직 연결/);
}));

test('external origins and unsupported content are rejected', async () => fixture(async base => {
  assert.equal((await fetch(base+'/preview-api/rooms',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify(data)})).status,403);
  assert.equal((await fetch(base+'/preview-api/rooms',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await fetch(base+'/preview-api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'})).status,400);
  const rebindingStatus = await new Promise((resolve,reject) => {
    const req=http.get(base+'/preview-api/status',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);
  });
  assert.equal(rebindingStatus,403);
}));
