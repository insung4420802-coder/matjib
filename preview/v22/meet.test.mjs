import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, normalizePoint, rankCandidates, referenceCenter, mapUrl } from './meet-core.js';
import { mountMeet } from './meet.js';

test('identical points have zero distance', () => {
  assert.equal(distanceKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 }), 0);
});

test('one degree on equator is about 111 km, symmetrical', () => {
  const a = { lat: 0, lng: 0 }, b = { lat: 0, lng: 1 };
  assert.ok(Math.abs(distanceKm(a, b) - 111.195) < 0.01);
  assert.equal(distanceKm(a, b), distanceKm(b, a));
});

test('minimax favors the midpoint over a point favorable to one participant', () => {
  const origins = [{ lat: 0, lng: 0, name: 'A' }, { lat: 0, lng: 10, name: 'B' }];
  const ranked = rankCandidates(origins, [{ id: 'edge', lat: 0, lng: 1 }, { id: 'middle', lat: 0, lng: 5 }]);
  assert.equal(ranked[0].id, 'middle');
  assert.equal(ranked[0].distances.length, 2);
  assert.equal(ranked[0].spreadKm, 0);
});

test('zero and empty cases remain explicit', () => {
  const origins = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }];
  assert.deepEqual(rankCandidates(origins, []), []);
  const [same] = rankCandidates(origins, [{ lat: 0, lng: 0 }]);
  assert.equal(same.maximumKm, 0);
  assert.equal(same.averageKm, 0);
  assert.deepEqual(referenceCenter(origins), { lat: 0, lng: 0, method: 'centroid', name: '참고 중심점' });
  assert.throws(() => rankCandidates([], []), /2~6/);
  assert.throws(() => rankCandidates([{ lat: 0, lng: 0 }], []), /2~6/);
});

test('invalid input cannot become a zero coordinate or NaN', () => {
  for (const point of [null, { lat: '', lng: 0 }, { lat: ' ', lng: 0 }, { lat: [], lng: 0 }, { lat: false, lng: 0 }, { lat: 1, lng: null }, { lat: Infinity, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 'bad', lng: 0 }]) {
    assert.throws(() => normalizePoint(point));
  }
  assert.equal(normalizePoint({ lat: '0', lng: '0' }).lat, 0);
});

test('date-line center does not incorrectly fall in Greenwich', () => {
  const origins = [{ lat: 0, lng: 179 }, { lat: 0, lng: -179 }];
  const center = referenceCenter(origins);
  assert.ok(Math.abs(Math.abs(center.lng) - 180) < 1e-8);
  assert.ok(distanceKm(origins[0], origins[1]) < 223);
  const [first] = rankCandidates(origins, [{ id: 'far', lat: 0, lng: 0 }, { id: 'near', lat: 0, lng: 180 }]);
  assert.equal(first.id, 'near');
});

test('antipodal points have a finite documented fallback', () => {
  const center = referenceCenter([{ lat: 0, lng: 0 }, { lat: 0, lng: 180 }]);
  assert.equal(center.method, 'medoid');
  assert.ok(Number.isFinite(center.lat) && Number.isFinite(center.lng));
});

test('bounds, stable ties and capacity limits', () => {
  const origins = [{ lat: 90, lng: 180 }, { lat: -90, lng: -180 }];
  const ranked = rankCandidates(origins, [{ id: 'a', lat: 0, lng: 0 }, { id: 'b', lat: 0, lng: 0 }]);
  assert.deepEqual(ranked.map(p => p.id), ['a', 'b']);
  assert.throws(() => rankCandidates(Array(7).fill(origins[0]), []), /2~6/);
  assert.throws(() => rankCandidates(origins, Array(51).fill({ lat: 0, lng: 0 })), /50/);
  assert.throws(() => rankCandidates(origins, null), /목록/);
});

test('external map links use validated coordinates, not an invented place listing', () => {
  assert.equal(mapUrl({ lat: 37.5, lng: 127 }), 'https://www.google.com/maps/search/?api=1&query=37.5%2C127');
  assert.throws(() => mapUrl({ lat: 99, lng: 0 }));
});

test('preview mount renders real calculation, blocks stale transfer, and cleans up', () => {
  const listeners = new Map();
  const messages = [];
  const root = {
    innerHTML: '',
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
    contains() { return true; },
    querySelector() { return { hidden: true, scrollIntoView() {} }; },
  };
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldCustomEvent = globalThis.CustomEvent;
  globalThis.document = { getElementById() { return null; } };
  globalThis.window = { dispatchEvent(event) { messages.push(event); } };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  try {
    const cleanup = mountMeet(root);
    assert.match(root.innerHTML, /거리 균형 1순위/);
    assert.match(root.innerHTML, /실제 식당이 아닌 가상 예시/);
    const click = action => listeners.get('click')({ target: { closest: () => ({ dataset: { meetAction: action } }) } });
    click('create-room');
    assert.equal(messages[0].type, 'preview:create-room');
    assert.equal(messages[0].detail.candidates.length, 3);
    assert.ok(messages[0].detail.candidates.every(place => place.address.includes('[실제 식당 아님]')));
    listeners.get('input')({ target: { dataset: { origin: 'origin-0', key: 'lat' }, value: '' } });
    click('create-room');
    assert.equal(messages.length, 1, 'stale results must not be shared');
    click('calculate');
    assert.match(root.innerHTML, /위도와 경도를 모두 입력/);
    assert.doesNotMatch(root.innerHTML, /거리 균형 1순위/);
    cleanup();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    globalThis.CustomEvent = oldCustomEvent;
  }
});
