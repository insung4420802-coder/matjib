import { randomBytes } from 'node:crypto';

const TOKEN = /^[a-f0-9]{48}$/;
const VOTES = new Set(['like', 'okay', 'no']);
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function text(value, label, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') fail(`${label}을(를) 입력해 주세요.`);
  const out = value.trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) fail(`${label}은(는) 1~${max}자로 입력해 주세요.`);
  return out;
}
const newToken = () => randomBytes(24).toString('hex');

/** Ephemeral preview storage. Never persists names or votes to disk. */
export class RoomStore {
  constructor({ now = () => Date.now(), ttlMs = 48 * 60 * 60 * 1000, maxRooms = 100 } = {}) {
    this.now = now; this.ttlMs = ttlMs; this.maxRooms = maxRooms; this.rooms = new Map();
  }
  prune() {
    for (const [id, room] of this.rooms) if (room.expiresAt <= this.now()) this.rooms.delete(id);
  }
  create(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('모임 정보 형식이 올바르지 않아요.');
    this.prune();
    if (this.rooms.size >= this.maxRooms) fail('미리보기 방이 가득 찼어요. 기존 방을 삭제하거나 나중에 다시 시도해 주세요.', 429);
    const title = text(input.title, '모임 이름', 60);
    const nickname = text(input.nickname, '닉네임', 20);
    if (!Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 5) fail('후보는 2~5곳을 입력해 주세요.');
    const candidates = input.candidates.map(c => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) fail('후보 형식이 올바르지 않아요.');
      return { id: newToken(), name: text(c.name, '식당 이름', 80), menu: text(c.menu, '메뉴', 80, true), address: text(c.address, '주소', 160, true) };
    });
    if (new Set(candidates.map(c => `${c.name.toLocaleLowerCase()}|${c.address.toLocaleLowerCase()}`)).size !== candidates.length) fail('같은 식당 후보가 중복되어 있어요.');
    let meetingAt = '';
    if (input.meetingAt) {
      if (typeof input.meetingAt !== 'string' || !Number.isFinite(Date.parse(input.meetingAt))) fail('모임 날짜와 시간이 올바르지 않아요.');
      const time = Date.parse(input.meetingAt);
      if (time < this.now() - 60_000 || time > this.now() + 366 * 86400_000) fail('모임 시간은 지금부터 1년 이내로 골라 주세요.');
      meetingAt = new Date(time).toISOString();
    }
    const id = newToken(), hostId = newToken(), memberToken = newToken();
    const room = { id, title, meetingAt, expiresAt: this.now() + this.ttlMs, hostId, candidates, members: [{ id: hostId, nickname, token: memberToken }], votes: {}, decision: null };
    this.rooms.set(id, room);
    return { room: this.public(room), memberToken };
  }
  find(id) {
    if (typeof id !== 'string' || !TOKEN.test(id)) fail('모임 링크가 올바르지 않아요.', 404);
    const room = this.rooms.get(id);
    if (!room) fail('모임을 찾을 수 없어요. 서버를 다시 시작했다면 새 방을 만들어 주세요.', 404);
    if (room.expiresAt <= this.now()) { this.rooms.delete(id); fail('48시간이 지나 모임이 만료되었어요.', 410); }
    return room;
  }
  member(room, token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) fail('이 모임에 먼저 참여해 주세요.', 401);
    const member = room.members.find(m => m.token === token);
    if (!member) fail('이 모임에 먼저 참여해 주세요.', 401);
    return member;
  }
  public(room) {
    return { id: room.id, title: room.title, meetingAt: room.meetingAt, expiresAt: new Date(room.expiresAt).toISOString(), hostId: room.hostId,
      members: room.members.map(({ id, nickname }) => ({ id, nickname })), candidates: room.candidates.map(c => ({ ...c })),
      votes: structuredClone(room.votes), decision: room.decision };
  }
  join(id, input = {}) {
    const room = this.find(id);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('참여 정보 형식이 올바르지 않아요.');
    if (room.decision) fail('이미 식당이 정해진 모임이에요.', 409);
    const nickname = text(input.nickname, '닉네임', 20);
    if (room.members.some(m => m.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) fail('이미 사용 중인 닉네임이에요. 다른 이름으로 참여해 주세요.', 409);
    if (room.members.length >= 6) fail('미리보기 모임은 최대 6명까지 참여할 수 있어요.', 409);
    const memberToken = newToken();
    room.members.push({ id: newToken(), nickname, token: memberToken });
    return { room: this.public(room), memberToken };
  }
  get(id, token) { const room = this.find(id); this.member(room, token); return this.public(room); }
  vote(id, token, input = {}) {
    const room = this.find(id), member = this.member(room, token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('투표 정보 형식이 올바르지 않아요.');
    if (room.decision) fail('식당이 정해진 뒤에는 투표를 바꿀 수 없어요.', 409);
    if (!room.candidates.some(c => c.id === input.candidateId)) fail('모임에 없는 후보예요.');
    if (!VOTES.has(input.value)) fail('투표 선택이 올바르지 않아요.');
    room.votes[member.id] ||= {};
    room.votes[member.id][input.candidateId] = input.value;
    return this.public(room);
  }
  decide(id, token, input = {}) {
    const room = this.find(id), member = this.member(room, token);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('식당 선택 정보 형식이 올바르지 않아요.');
    if (member.id !== room.hostId) fail('모임을 만든 사람만 최종 식당을 정할 수 있어요.', 403);
    if (room.decision) fail('이미 식당이 정해진 모임이에요.', 409);
    if (!room.candidates.some(c => c.id === input.candidateId)) fail('모임에 없는 후보예요.');
    // A unanimous recommendation must not silently treat missing votes as consent.
    if (!room.members.every(m => ['like', 'okay'].includes(room.votes[m.id]?.[input.candidateId]))) fail('모두가 좋아요 또는 괜찮아요로 투표한 후보만 확정할 수 있어요.', 409);
    room.decision = input.candidateId;
    return this.public(room);
  }
  delete(id, token) {
    const room = this.find(id), member = this.member(room, token);
    if (member.id !== room.hostId) fail('모임을 만든 사람만 삭제할 수 있어요.', 403);
    this.rooms.delete(id); return { deleted: true };
  }
}
