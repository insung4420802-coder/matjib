import { createHmac } from 'node:crypto';

export function toolsError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function setPrivateHeaders(res) {
  res.setHeader?.('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  res.setHeader?.('Referrer-Policy', 'no-referrer');
  res.setHeader?.('Vary', 'Origin, X-Imm-Key, Authorization');
}

export function assertSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin && ['GET', 'HEAD'].includes(req.method)) return;
  if (typeof origin !== 'string' || typeof req.headers?.host !== 'string') throw toolsError('이 사이트에서 다시 시도해 주세요.', 403);
  try {
    const parsed = new URL(origin);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host);
    if (parsed.origin !== origin || parsed.host !== req.headers.host || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) throw new Error();
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error();
  } catch { throw toolsError('외부 사이트의 요청은 허용하지 않습니다.', 403); }
}

export async function readToolsJson(req, maxBytes = 20_000) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers?.['content-type'] || ''))) throw toolsError('JSON 형식으로 요청해 주세요.', 415);
  const length = Number(req.headers?.['content-length']);
  if (Number.isFinite(length) && length > maxBytes) throw toolsError('입력 크기가 너무 큽니다.', 413);
  let body = req.body;
  if (body === undefined && typeof req[Symbol.asyncIterator] === 'function') {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw toolsError('입력 크기가 너무 큽니다.', 413);
      chunks.push(buffer);
    }
    body = Buffer.concat(chunks);
  }
  try {
    const serialized = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body);
    if (typeof serialized !== 'string') throw new Error();
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw toolsError('입력 크기가 너무 큽니다.', 413);
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error.status === 413) throw error;
    throw toolsError('입력 내용을 읽을 수 없습니다.');
  }
}

export function clientFingerprint(req, env = process.env) {
  // Vercel overwrites this header. Never trust arbitrary X-Forwarded-For.
  const forwarded = env.VERCEL === '1' ? req.headers?.['x-vercel-forwarded-for'] : undefined;
  const address = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
  const salt = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || 'matjib-tools-local-ip-v1';
  return createHmac('sha256', salt).update(String(address).slice(0, 128)).digest('hex').slice(0, 32);
}

export const RATE_LIMIT_SCRIPT = `-- matjib-tools-rate-v1
local value = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if value == 1 or ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]); ttl = tonumber(ARGV[2]) end
local allowed = 0
if value <= tonumber(ARGV[1]) then allowed = 1 end
return {allowed, math.max(0, tonumber(ARGV[1]) - value), ttl}`;

export async function enforceRateLimit(redis, { key, limit, windowSeconds }) {
  if (typeof key !== 'string' || !key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new TypeError('Invalid rate limit');
  const result = await redis.command(['EVAL', RATE_LIMIT_SCRIPT, 1, key, limit, windowSeconds]);
  if (!Array.isArray(result) || result.length !== 3) throw toolsError('요청 한도를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503);
  if (Number(result[0]) !== 1) {
    const error = toolsError('요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429);
    error.retryAfter = Math.max(1, Number(result[2]) || windowSeconds); throw error;
  }
  return { remaining: Number(result[1]), resetAfter: Number(result[2]) };
}
