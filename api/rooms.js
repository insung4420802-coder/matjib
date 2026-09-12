import { createRedisClient, redisConfigured, redisNamespace } from '../server-lib/redis.js';
import { PersistentRooms } from '../server-lib/persistent-rooms.js';
import { assertSameOrigin, clientFingerprint, enforceRateLimit, readToolsJson, setPrivateHeaders, toolsError } from '../server-lib/tools-security.js';

function queryValue(req, key) {
  const value = req.query?.[key];
  if (Array.isArray(value)) throw toolsError('요청 주소가 올바르지 않습니다.');
  if (value !== undefined) return String(value);
  try { const values = new URL(req.url, 'https://local.invalid').searchParams.getAll(key); if (values.length > 1) throw new Error(); return values[0] || ''; }
  catch { throw toolsError('요청 주소가 올바르지 않습니다.'); }
}

export function createRoomsHandler({ env = process.env, redis, now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    setPrivateHeaders(res);
    try {
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw toolsError('지원하지 않는 요청입니다.', 405);
      assertSameOrigin(req);
      const id = queryValue(req, 'id'), action = queryValue(req, 'action');
      if (req.method === 'GET' && !id && action === 'status') {
        return res.status(200).json({ available: Boolean(redis || redisConfigured(env)), storage: redis || redisConfigured(env) ? 'persistent' : 'unconfigured', accessKeyRequired: Boolean(env.APP_ACCESS_KEY) });
      }
      if (env.APP_ACCESS_KEY && req.headers?.['x-imm-key'] !== env.APP_ACCESS_KEY) throw Object.assign(toolsError('접근 코드가 필요합니다.', 401), { code: 'ACCESS_KEY_REQUIRED' });
      if (!redis && !redisConfigured(env)) throw toolsError('모임 저장소가 아직 연결되지 않았습니다. 잠시 후 다시 이용해 주세요.', 503);
      if (id && !/^[a-f0-9]{48}$/.test(id)) throw toolsError('모임 링크가 올바르지 않습니다.', 404);
      const validRoute = req.method === 'POST' ? (!id && !action) || (id && ['join', 'votes', 'decision'].includes(action)) : id && !action;
      if (!validRoute) throw toolsError('요청 주소가 올바르지 않습니다.', 404);
      const authorization = req.headers?.authorization;
      const token = typeof authorization === 'string' && /^Bearer [a-f0-9]{48}$/.test(authorization) ? authorization.slice(7) : '';
      if (id && action !== 'join' && !token) throw toolsError('이 모임에 먼저 참여해 주세요.', 401);
      const body = req.method === 'POST' ? await readToolsJson(req, 20_000) : null;
      const client = redis || createRedisClient({ env }), namespace = redisNamespace(env);
      const fingerprint = clientFingerprint(req, env);
      await enforceRateLimit(client, { key: `${namespace}:limit:rooms:${fingerprint}:${req.method === 'GET' ? 'read' : 'write'}`, limit: req.method === 'GET' ? 40 : 30, windowSeconds: 60 });
      if (req.method === 'POST' && !id && !action) await enforceRateLimit(client, { key: `${namespace}:limit:rooms:create:${fingerprint}`, limit: 10, windowSeconds: 3600 });
      const rooms = new PersistentRooms({ redis: client, env, now });
      if (req.method === 'GET' && id && !action) return res.status(200).json(await rooms.get(id, token));
      if (req.method === 'DELETE' && id && !action) return res.status(200).json(await rooms.delete(id, token));
      if (req.method === 'POST') {
        if (!id && !action) return res.status(201).json(await rooms.create(body));
        if (id && action === 'join') return res.status(200).json(await rooms.join(id, body));
        if (id && action === 'votes') return res.status(200).json(await rooms.vote(id, token, body));
        if (id && action === 'decision') return res.status(200).json(await rooms.decide(id, token, body));
      }
      throw toolsError('요청 주소가 올바르지 않습니다.', 404);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      if (error.retryAfter) res.setHeader?.('Retry-After', String(error.retryAfter));
      return res.status(status).json({ error: status === 500 ? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' : error.message, ...(error.code ? { code: error.code } : {}) });
    }
  };
}

export default createRoomsHandler();
