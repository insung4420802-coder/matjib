import test from 'node:test';
import assert from 'node:assert/strict';
import {api,apiUrl} from './shared.js';
import {MENU_CLIENT_TIMEOUT_MS} from './menu-analysis-policy.js';

test('hosted tools route only to their known API endpoints',()=>{
  const id='a'.repeat(48);
  assert.equal(apiUrl('/status',true),'/api/menu-photo');
  assert.equal(apiUrl('/menu-parse',true),'/api/menu-photo');
  assert.equal(apiUrl('/rooms',true),'/api/rooms');
  assert.equal(apiUrl(`/rooms/${id}/join`,true),`/api/rooms?id=${id}&action=join`);
  assert.equal(apiUrl(`/rooms/${id}/votes`,true),`/api/rooms?id=${id}&action=votes`);
  assert.equal(apiUrl(`/rooms/${id}`,true),`/api/rooms?id=${id}`);
  assert.throws(()=>apiUrl('/rooms/../../other',true));
  assert.throws(()=>apiUrl('https://other.example',true));
});
test('local preview preserves its isolated API routing',()=>{
  assert.equal(apiUrl('/status',false),'/preview-api/status');
  assert.equal(apiUrl('/rooms',false),'/preview-api/rooms');
});

test('only menu analysis gets the longer deadline and success clears every timer',async t=>{
  const scheduled=[],cleared=[];
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=scheduled.length+1;scheduled.push({callback,delay,id});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>cleared.push(id));
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>({ok:true})};});
  await api('/menu-parse',{method:'POST',body:{images:['sample']}});
  await api('/status');await api('/rooms');
  assert.deepEqual(scheduled.map(timer=>timer.delay),[MENU_CLIENT_TIMEOUT_MS,45000,45000]);
  assert.deepEqual(cleared,[1,2,3]);assert.equal(calls.length,3);
  assert.equal(calls[0].options.credentials,'same-origin');
});

test('HTML gateway timeout keeps 504 and gives menu-specific recovery without retry',async t=>{
  let calls=0,cleared=0;
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>cleared++);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return{ok:false,status:504,json:async()=>{throw new SyntaxError('HTML is not JSON');}};});
  await assert.rejects(api('/menu-parse',{method:'POST',body:{}}),error=>{
    assert.equal(error.status,504);assert.equal(error.code,'MENU_ANALYSIS_TIMEOUT');
    assert.match(error.message,/사진/);assert.match(error.message,/자동 재시도/);return true;
  });
  assert.equal(calls,1);assert.equal(cleared,1);
});

test('JSON API errors preserve useful status and machine-readable code',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  t.mock.method(globalThis,'fetch',async()=>({ok:false,status:504,json:async()=>({error:'분석 시간이 초과되었습니다.',code:'MENU_ANALYSIS_TIMEOUT'})}));
  await assert.rejects(api('/menu-parse',{method:'POST',body:{}}),error=>error.status===504&&error.code==='MENU_ANALYSIS_TIMEOUT'&&error.message==='분석 시간이 초과되었습니다.');
});

test('client abort keeps selected photos actionable and makes no automatic second request',async t=>{
  let fireTimeout,delay,calls=0,cleared=0;
  t.mock.method(globalThis,'setTimeout',(callback,ms)=>{fireTimeout=callback;delay=ms;return 1;});
  t.mock.method(globalThis,'clearTimeout',()=>cleared++);
  t.mock.method(globalThis,'fetch',(_url,options)=>{calls++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));});
  const pending=api('/menu-parse',{method:'POST',body:{images:['sample']}});fireTimeout();
  await assert.rejects(pending,error=>{
    assert.equal(error.status,408);assert.equal(error.code,'MENU_CLIENT_TIMEOUT');assert.match(error.message,/선택한 사진은 유지/);return true;
  });
  assert.equal(delay,MENU_CLIENT_TIMEOUT_MS);assert.equal(calls,1);assert.equal(cleared,1);
});

test('a body-read abort is recognized as timeout, not a malformed response',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>{throw Object.assign(new Error('aborted reading body'),{name:'AbortError'});}}));
  await assert.rejects(api('/menu-parse',{method:'POST',body:{}}),error=>error.code==='MENU_CLIENT_TIMEOUT');
});

test('non-menu timeout keeps its standard deadline and avoids photo-only copy',async t=>{
  let delay;
  t.mock.method(globalThis,'setTimeout',(_callback,ms)=>{delay=ms;return 1;});t.mock.method(globalThis,'clearTimeout',()=>{});
  t.mock.method(globalThis,'fetch',async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'});});
  await assert.rejects(api('/rooms'),error=>error.code==='REQUEST_TIMEOUT'&&!error.message.includes('사진'));
  assert.equal(delay,45000);
});
