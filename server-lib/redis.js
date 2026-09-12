const unavailable = () => Object.assign(new Error('도구 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'), { status: 503 });

function credentials(env) {
  const pairs = [
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
  ];
  for (const [rawUrl, token] of pairs) {
    if (typeof rawUrl !== 'string' || typeof token !== 'string' || !rawUrl.trim() || !token.trim()) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) continue;
      return { url: url.origin, token: token.trim() };
    } catch {}
  }
  return null;
}

export function redisConfigured(env = process.env) { return Boolean(credentials(env)); }
export function redisNamespace(env = process.env) {
  const scope = ['production', 'preview'].includes(env.VERCEL_ENV) ? env.VERCEL_ENV : 'development';
  return `matjib:v22:${scope}`;
}

/** One authenticated Redis REST command; no automatic write retries. */
export function createRedisClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = credentials(env);
  return {
    async command(commandArray) {
      if (!config || typeof fetchImpl !== 'function') throw unavailable();
      if (!Array.isArray(commandArray) || !commandArray.length || commandArray.some(x => !['string', 'number'].includes(typeof x))) throw new TypeError('Invalid Redis command');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetchImpl(config.url, {
          method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(commandArray), signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw unavailable();
        const json = await response.json();
        if (!json || typeof json !== 'object' || json.error || !Object.prototype.hasOwnProperty.call(json, 'result')) throw unavailable();
        return json.result;
      } catch { throw unavailable(); }
      finally { clearTimeout(timer); }
    },
  };
}
