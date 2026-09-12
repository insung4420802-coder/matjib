import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidates, createHandoff, consumeHandoff, cleanupHandoffs, HANDOFF_PREFIX, HANDOFF_TTL_MS } from './handoff.js';

const ID = '12345678-1234-4234-8234-123456789abc';
const ID2 = '12345678-1234-4234-8234-123456789abd';
const NOW = 2000000;
const domestic = (id = '1', patch = {}) => ({ id, place_name: `식당 ${id}`, road_address_name: '도로명 주소', address_name: '지번 주소', category_name: '음식점 > 한식', x: '127.02', y: '37.49', ...patch });
const overseas = (id = '1', patch = {}) => ({ id, name: `Restaurant ${id}`, address: 'Tokyo', category: 'Soba', lat: 35.68, lng: 139.76, ...patch });
function memoryStorage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function storeEnvelope(storage, patch = {}, id = ID) {
  storage.setItem(HANDOFF_PREFIX + id, JSON.stringify({ version: 1, createdAt: NOW, target: 'meet', candidates: normalizeCandidates([domestic()]), ...patch }));
}

test('domestic candidates use Kakao y/x and copy public allowlist fields only', () => {
  const original = domestic('1', { _imm: { stars: 5 }, _reviews: ['private'], accessKey: 'secret', manualCenter: { lat: 1, lng: 2 }, distance: 15 });
  const before = structuredClone(original);
  assert.deepEqual(normalizeCandidates([original]), [{ id: 'domestic:1', name: '식당 1', address: '도로명 주소', menu: '분류: 음식점 > 한식', lat: 37.49, lng: 127.02, source: 'search', demo: false }]);
  assert.deepEqual(original, before);
});

test('overseas and ovs modes agree and missing ratings are never copied', () => {
  const places = [overseas('1', { rating: 4.8, ratingCount: 500, reviews: ['review'] })];
  const candidates = normalizeCandidates(places, { mode: 'overseas' });
  assert.deepEqual(normalizeCandidates(places, { mode: 'ovs' }), candidates);
  assert.equal(candidates[0].id, 'overseas:1');
  assert.equal(candidates[0].lat, 35.68);
  assert.equal('rating' in candidates[0], false);
  assert.equal('reviews' in candidates[0], false);
});

test('room candidates may omit coordinates, meet candidates may not', () => {
  const bad = [domestic('1', { y: '', x: null }), domestic('2', { y: false }), domestic('3', { y: '91' }), domestic('4', { x: Infinity })];
  assert.deepEqual(normalizeCandidates(bad), []);
  assert.ok(normalizeCandidates(bad, { target: 'rooms' }).every(c => c.lat === null && c.lng === null));
  assert.deepEqual(normalizeCandidates([domestic('0', { y: 0, x: 0 })])[0].lat, 0);
});

test('candidate counts, identities and text lengths are bounded', () => {
  const places = Array.from({ length: 60 }, (_, i) => domestic(String(i)));
  assert.equal(normalizeCandidates(places).length, 50);
  assert.equal(normalizeCandidates(places, { target: 'rooms' }).length, 5);
  assert.equal(normalizeCandidates([domestic(), domestic(), domestic('2', { place_name: '식당 1' })]).length, 1);
  const [bounded] = normalizeCandidates([domestic('1', { place_name: 'x'.repeat(100), road_address_name: 'y'.repeat(200), category_name: 'z'.repeat(100) })]);
  assert.equal(bounded.name.length, 80); assert.equal(bounded.address.length, 160); assert.equal(bounded.menu.length, 80);
  assert.deepEqual(normalizeCandidates([null, [], {}, domestic('1', { place_name: '  ' })]), []);
  assert.throws(() => normalizeCandidates({}, {}));
  assert.throws(() => normalizeCandidates(places, { target: 'other' }));
  assert.throws(() => normalizeCandidates(places, { mode: 'other' }));
});

test('handoff round trip preserves normalized domestic coordinates and consumes once', () => {
  const storage = memoryStorage();
  const result = createHandoff([domestic()], { storage, now: NOW, id: ID });
  assert.deepEqual(result, { id: ID, count: 1 });
  const received = consumeHandoff(ID, { storage, now: NOW + 1 });
  assert.deepEqual(received, { candidates: normalizeCandidates([domestic()]), target: 'meet' });
  assert.equal(storage.getItem(HANDOFF_PREFIX + ID), null);
  assert.equal(consumeHandoff(ID, { storage, now: NOW + 2 }), null);
});

test('creation rejects empty/one-room candidates and unavailable storage', () => {
  const storage = memoryStorage();
  assert.throws(() => createHandoff([], { storage, now: NOW, id: ID }), /후보/);
  assert.throws(() => createHandoff([domestic()], { storage, target: 'rooms', now: NOW, id: ID }), /2곳/);
  assert.throws(() => createHandoff([domestic()], { storage: null, now: NOW, id: ID }), /저장/);
  assert.throws(() => createHandoff([domestic()], { storage: { ...memoryStorage(), setItem() { throw new Error('quota'); } }, now: NOW, id: ID }), /저장/);
  assert.throws(() => createHandoff([domestic()], { storage, now: NOW, id: '../bad' }), /전달/);
});

test('room handoff permits null coordinates without inventing a zero location', () => {
  const storage = memoryStorage();
  createHandoff([domestic('1', { x: null }), domestic('2')], { storage, target: 'rooms', now: NOW, id: ID });
  const received = consumeHandoff(ID, { storage, now: NOW });
  assert.equal(received.target, 'rooms');
  assert.equal(received.candidates[0].lat, null); assert.equal(received.candidates[0].lng, null);
});

test('malformed, future and expired entries are removed without returning candidates', () => {
  for (const patch of [{ version: 2 }, { target: 'other' }, { createdAt: NOW + 1 }, { createdAt: NOW - HANDOFF_TTL_MS }, { candidates: {} }, { candidates: [null] }, { candidates: [] }]) {
    const storage = memoryStorage(); storeEnvelope(storage, patch);
    assert.equal(consumeHandoff(ID, { storage, now: NOW }), null);
    assert.equal(storage.getItem(HANDOFF_PREFIX + ID), null);
  }
  const storage = memoryStorage(); storage.setItem(HANDOFF_PREFIX + ID, '{bad');
  assert.equal(consumeHandoff(ID, { storage, now: NOW }), null);
  assert.equal(storage.length, 0);
});

test('stored candidate schema is validated separately and unknown fields are dropped', () => {
  const [candidate] = normalizeCandidates([domestic()]);
  for (const patch of [{ lat: '37' }, { lat: null }, { lng: 181 }, { id: 'unprefixed' }, { name: 'x'.repeat(81) }, { demo: true }, { source: 'gps' }, { menu: 'unlabeled category' }]) {
    const storage = memoryStorage(); storeEnvelope(storage, { candidates: [{ ...candidate, ...patch }] });
    assert.equal(consumeHandoff(ID, { storage, now: NOW }), null);
  }
  const storage = memoryStorage(); storeEnvelope(storage, { candidates: [{ ...candidate, latitude: 1, privateKey: 'secret' }] });
  assert.deepEqual(consumeHandoff(ID, { storage, now: NOW }).candidates, [candidate]);
});

test('invalid ids never read or delete other application storage', () => {
  const storage = memoryStorage(); storage.setItem('imm_access_key', 'secret');
  let calls = 0;
  const watched = { getItem() { calls++; }, removeItem() { calls++; } };
  assert.equal(consumeHandoff('imm_access_key', { storage: watched, now: NOW }), null);
  assert.equal(calls, 0);
  assert.equal(storage.getItem('imm_access_key'), 'secret');
});

test('cleanup removes only expired owned UUID keys and preserves other data', () => {
  const storage = memoryStorage();
  storeEnvelope(storage, { createdAt: NOW - HANDOFF_TTL_MS }, ID);
  storeEnvelope(storage, { createdAt: NOW - HANDOFF_TTL_MS + 1 }, ID2);
  storage.setItem('imm_favs', '{}'); storage.setItem(HANDOFF_PREFIX + 'unrelated', 'not ours');
  assert.equal(cleanupHandoffs({ storage, now: NOW }), 1);
  assert.notEqual(storage.getItem(HANDOFF_PREFIX + ID2), null);
  assert.equal(storage.getItem('imm_favs'), '{}');
  assert.equal(storage.getItem(HANDOFF_PREFIX + 'unrelated'), 'not ours');
});

test('create does not overwrite an existing live handoff and failed removal never consumes', () => {
  const storage = memoryStorage(); storeEnvelope(storage);
  const original = storage.getItem(HANDOFF_PREFIX + ID);
  assert.throws(() => createHandoff([domestic('2')], { storage, now: NOW, id: ID }), /저장/);
  assert.equal(storage.getItem(HANDOFF_PREFIX + ID), original);
  assert.equal(consumeHandoff(ID, { storage: { getItem: storage.getItem, removeItem() { throw new Error('blocked'); } }, now: NOW }), null);
});

test('browser storage getter restrictions produce safe create/consume outcomes', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.equal(consumeHandoff(ID, { now: NOW }), null);
    assert.throws(() => createHandoff([domestic()], { now: NOW, id: ID }), /저장/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
