import { createHash } from 'node:crypto';
import { RoomStore } from '../preview/v22/room-store.mjs';
import { redisNamespace } from './redis.js';
import { toolsError } from './tools-security.js';

const TOKEN = /^[a-f0-9]{48}$/;
const HASH = /^[a-f0-9]{64}$/;
const TTL = 48 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
export const ROOM_CREATE_SCRIPT = `-- matjib-room-create-v1
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1`;
export const ROOM_CAS_SCRIPT = `-- matjib-room-cas-v1
local current = redis.call('GET', KEYS[1])
if not current then return -1 end
if current ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL', KEYS[1]); return 1 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;

function safeStored(room) {
  return {
    id: room.id, title: room.title, meetingAt: room.meetingAt, expiresAt: room.expiresAt, hostId: room.hostId,
    candidates: room.candidates.map(({ id, name, menu, address }) => ({ id, name, menu, address })),
    members: room.members.map(m => ({ id: m.id, nickname: m.nickname, tokenHash: m.tokenHash || digest(m.token) })),
    votes: structuredClone(room.votes), decision: room.decision,
  };
}
function decoded(raw, id) {
  try {
    const data = JSON.parse(raw);
    if (data.schema !== 1 || !Number.isSafeInteger(data.version) || data.version < 1 || data.room?.id !== id) throw new Error();
    const room = data.room;
    if (!Number.isSafeInteger(room.expiresAt) || !Array.isArray(room.members) || room.members.length < 1 || room.members.length > 6 ||
        !room.members.every(m => TOKEN.test(m.id) && HASH.test(m.tokenHash) && !Object.prototype.hasOwnProperty.call(m, 'token')) ||
        !Array.isArray(room.candidates) || room.candidates.length < 2 || room.candidates.length > 5 || !room.candidates.every(c => TOKEN.test(c.id)) ||
        !room.members.some(m => m.id === room.hostId) || !room.votes || typeof room.votes !== 'object') throw new Error();
    return data;
  } catch { throw toolsError('모임 정보를 안전하게 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.', 503); }
}

/** Optimistic compare-and-swap keeps validation and membership updates atomic. */
export class PersistentRooms {
  constructor({ redis, env = process.env, now = () => Date.now(), maxRetries = 8 } = {}) {
    if (!redis?.command) throw new TypeError('Redis client required');
    this.redis = redis; this.now = now; this.maxRetries = maxRetries; this.prefix = `${redisNamespace(env)}:room:`;
  }
  key(id) {
    if (typeof id !== 'string' || !TOKEN.test(id)) throw toolsError('모임 링크가 올바르지 않습니다.', 404);
    return this.prefix + id;
  }
  memberToken(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw toolsError('이 모임에 먼저 참여해 주세요.', 401);
    // Hydrated RoomStore uses only a derived 192-bit verifier, never the bearer token.
    return digest(token).slice(0, 48);
  }
  hydrate(stored) {
    const store = new RoomStore({ now: this.now });
    const room = structuredClone(stored.room);
    room.members = room.members.map(m => ({ ...m, token: m.tokenHash.slice(0, 48) }));
    store.rooms.set(room.id, room); return store;
  }
  async load(id) {
    const raw = await this.redis.command(['GET', this.key(id)]);
    if (raw === null) throw toolsError('모임을 찾을 수 없습니다. 링크를 확인하거나 새 모임을 만들어 주세요.', 404);
    if (typeof raw !== 'string') throw toolsError('모임 정보를 불러올 수 없습니다.', 503);
    const stored = decoded(raw, id);
    if (stored.room.expiresAt <= this.now()) throw toolsError('48시간이 지나 모임이 만료되었습니다.', 410);
    return { raw, stored };
  }
  async create(input) {
    const store = new RoomStore({ now: this.now, ttlMs: TTL });
    const result = store.create(input);
    const serialized = JSON.stringify({ schema: 1, version: 1, room: safeStored(store.rooms.get(result.room.id)) });
    const saved = await this.redis.command(['EVAL', ROOM_CREATE_SCRIPT, 1, this.key(result.room.id), serialized, TTL]);
    if (Number(saved) !== 1) throw toolsError('모임을 만들지 못했습니다. 다시 시도해 주세요.', 409);
    return result;
  }
  async get(id, token) {
    const verified = this.memberToken(token), { stored } = await this.load(id);
    return this.hydrate(stored).get(id, verified);
  }
  async change(id, method, token, input) {
    const verified = method === 'join' ? null : this.memberToken(token);
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const { raw, stored } = await this.load(id);
      const store = this.hydrate(stored);
      const result = method === 'join' ? store.join(id, input) : store[method](id, verified, input);
      const ttl = stored.room.expiresAt - this.now();
      if (ttl <= 0) throw toolsError('48시간이 지나 모임이 만료되었습니다.', 410);
      const next = method === 'delete' ? '' : JSON.stringify({ schema: 1, version: stored.version + 1, room: safeStored(store.rooms.get(id)) });
      const changed = Number(await this.redis.command(['EVAL', ROOM_CAS_SCRIPT, 1, this.key(id), raw, next, ttl]));
      if (changed === 1) return result;
      if (changed === -1) throw toolsError('모임이 만료되었거나 삭제되었습니다.', 404);
      if (changed !== 0) throw toolsError('모임을 안전하게 저장하지 못했습니다.', 503);
    }
    throw toolsError('다른 참여자의 변경 사항을 반영 중입니다. 잠시 후 다시 시도해 주세요.', 409);
  }
  join(id, input) { return this.change(id, 'join', null, input); }
  vote(id, token, input) { return this.change(id, 'vote', token, input); }
  decide(id, token, input) { return this.change(id, 'decide', token, input); }
  delete(id, token) { return this.change(id, 'delete', token); }
}
