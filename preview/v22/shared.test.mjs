import test from 'node:test';
import assert from 'node:assert/strict';
import {apiUrl} from './shared.js';

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
