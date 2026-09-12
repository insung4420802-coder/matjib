// One-use, same-origin transfer of public restaurant fields only.
export const HANDOFF_PREFIX = 'imm_v22_handoff:';
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const maxCandidates = target => target === 'rooms' ? 5 : 50;
const validTarget = target => target === 'meet' || target === 'rooms';
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => { throw new Error(message); };

function coordinates(lat, lng) {
  const present = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  if (!present(lat) || !present(lng)) return { lat: null, lng: null };
  const latitude = Number(lat), longitude = Number(lng);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { lat: latitude, lng: longitude } : { lat: null, lng: null };
}

function normalizedMode(mode) {
  if (mode === 'ovs' || mode === 'overseas') return 'overseas';
  if (mode === 'domestic') return mode;
  fail('검색 유형을 확인하지 못했습니다. 다시 시도해 주세요.');
}

export function normalizeCandidates(places, { mode = 'domestic', target = 'meet' } = {}) {
  if (!Array.isArray(places) || !validTarget(target)) fail('전달할 식당 후보를 확인해 주세요.');
  const sourceMode = normalizedMode(mode);
  const candidates = [], ids = new Set(), identities = new Set();
  for (const [index, place] of places.entries()) {
    if (!plainObject(place)) continue;
    const domestic = sourceMode === 'domestic';
    const name = clean(domestic ? place.place_name || place.name : place.name, 80);
    if (!name) continue;
    const address = clean(domestic ? place.road_address_name || place.address_name || place.address : place.address, 160);
    const category = clean(domestic ? place.category_name || place.category : place.category, 76);
    const point = coordinates(domestic ? place.y : place.lat, domestic ? place.x : place.lng);
    if (target === 'meet' && point.lat === null) continue;
    const rawId = typeof place.id === 'number' && Number.isFinite(place.id) ? String(place.id) : clean(place.id, 160);
    const id = `${sourceMode}:${rawId || `candidate-${index}`}`;
    const identity = `${name.toLocaleLowerCase()}|${address.toLocaleLowerCase()}`;
    if (ids.has(id) || identities.has(identity)) continue;
    ids.add(id); identities.add(identity);
    candidates.push({ id, name, address, menu: category ? `분류: ${category}` : '', ...point, source: 'search', demo: false });
    if (candidates.length >= maxCandidates(target)) break;
  }
  return candidates;
}

function isExpired(createdAt, now) {
  return !validTime(createdAt) || createdAt > now || now - createdAt >= HANDOFF_TTL_MS;
}

export function cleanupHandoffs({ storage, now = Date.now() } = {}) {
  if (storage === undefined) storage = globalThis.localStorage;
  if (!storage || !validTime(now)) fail('식당 후보 임시 저장소를 사용할 수 없습니다.');
  // Snapshot keys before deletion; never touch unrelated app data.
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (typeof key === 'string' && key.startsWith(HANDOFF_PREFIX) && UUID.test(key.slice(HANDOFF_PREFIX.length))) keys.push(key);
  }
  let removed = 0;
  for (const key of keys) {
    let value;
    try { const raw = storage.getItem(key); value = typeof raw === 'string' && raw.length <= 100000 ? JSON.parse(raw) : null; } catch { value = null; }
    if (!plainObject(value) || isExpired(value.createdAt, now)) { storage.removeItem(key); removed++; }
  }
  return removed;
}

export function createHandoff(places, { storage, mode = 'domestic', target = 'meet', now = Date.now(), id = globalThis.crypto.randomUUID() } = {}) {
  if (typeof id !== 'string' || !UUID.test(id) || !validTime(now)) fail('식당 후보 전달 정보를 만들지 못했습니다. 다시 시도해 주세요.');
  const candidates = normalizeCandidates(places, { mode, target });
  if (!candidates.length) fail(target === 'meet' ? '좌표가 확인된 식당 후보가 없습니다.' : '전달할 식당 후보가 없습니다.');
  if (target === 'rooms' && candidates.length < 2) fail('모임을 만들려면 서로 다른 식당 후보를 2곳 이상 선택해 주세요.');
  const key = HANDOFF_PREFIX + id;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') throw new Error();
    cleanupHandoffs({ storage, now });
    if (storage.getItem(key) !== null) fail('이미 사용 중인 후보 전달 정보입니다. 다시 시도해 주세요.');
    const serialized = JSON.stringify({ version: 1, createdAt: now, target, candidates });
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) { storage.removeItem(key); throw new Error(); }
  } catch {
    fail('식당 후보를 임시 저장하지 못했습니다. 브라우저 저장 공간·권한을 확인해 주세요. 기존 검색은 그대로 유지됩니다.');
  }
  return { id: String(id), count: candidates.length };
}

function validateStoredCandidates(values, target) {
  if (!Array.isArray(values) || !values.length || values.length > maxCandidates(target) || (target === 'rooms' && values.length < 2)) return null;
  const ids = new Set(), identities = new Set(), candidates = [];
  for (const value of values) {
    if (!plainObject(value) || value.source !== 'search' || value.demo !== false) return null;
    if (typeof value.id !== 'string' || !/^(?:domestic|overseas):[^\u0000-\u001f\u007f]{1,160}$/.test(value.id)) return null;
    for (const [field, max] of [['name', 80], ['address', 160], ['menu', 80]]) {
      if (typeof value[field] !== 'string' || value[field].length > max || value[field] !== clean(value[field], max)) return null;
    }
    if (!value.name || (value.menu && !value.menu.startsWith('분류: '))) return null;
    // Saved candidates already have normalized lat/lng. Never re-read Kakao x/y here.
    const bothNull = value.lat === null && value.lng === null;
    if (bothNull && target !== 'rooms') return null;
    if (!bothNull && (typeof value.lat !== 'number' || typeof value.lng !== 'number' || coordinates(value.lat, value.lng).lat === null)) return null;
    const identity = `${value.name.toLocaleLowerCase()}|${value.address.toLocaleLowerCase()}`;
    if (ids.has(value.id) || identities.has(identity)) return null;
    ids.add(value.id); identities.add(identity);
    candidates.push({ id: value.id, name: value.name, address: value.address, menu: value.menu, lat: value.lat, lng: value.lng, source: 'search', demo: false });
  }
  return candidates;
}

export function consumeHandoff(id, { storage, now = Date.now() } = {}) {
  if (typeof id !== 'string' || !UUID.test(id) || !validTime(now)) return null;
  const key = HANDOFF_PREFIX + id;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    if (!storage) return null;
    const raw = storage.getItem(key);
    // Remove even malformed/expired entries, before parsing or returning anything.
    storage.removeItem(key);
    if (raw === null || typeof raw !== 'string' || raw.length > 100000) return null;
    const value = JSON.parse(raw);
    if (!plainObject(value) || value.version !== 1 || !validTarget(value.target) || isExpired(value.createdAt, now)) return null;
    const candidates = validateStoredCandidates(value.candidates, value.target);
    return candidates ? { candidates, target: value.target } : null;
  } catch { return null; }
}
