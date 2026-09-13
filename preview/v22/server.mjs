import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { RoomStore } from './room-store.mjs';
import { parseMenuPhoto } from './menu-api.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const staticFiles = new Set(['index.html', 'style.css', 'app.js', 'shared.js', 'handoff.js', 'rooms.js', 'menu.js', 'menu-core.js', 'menu-pages.js', 'menu-photo-list.js', 'menu-photo-optimize.js', 'menu-analysis-policy.js', 'meet.js', 'meet-core.js', 'rooms.css', 'menu.css', 'meet.css']);
const mime = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function json(res, status, body) { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); }
async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail('JSON 형식의 요청만 받을 수 있습니다.', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4200000) throw fail('입력 크기가 너무 큽니다. 사진을 다시 선택해 자동 최적화해 주세요.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail('입력 내용을 읽을 수 없습니다.'); }
}

export function createPreviewServer({apiKey = process.env.ANTHROPIC_API_KEY || '', model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', store = new RoomStore()} = {}) {
  const limits = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
      if (!allowedHosts.has(req.headers.host)) throw fail('로컬 미리보기 주소에서만 접근할 수 있습니다.', 403);
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin) throw fail('외부 사이트의 요청은 허용되지 않습니다.', 403);
      const url = new URL(req.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith('/preview-api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw fail('지원하지 않는 요청입니다.', 405);
        if (pathname === '/') { res.writeHead(302, { Location: '/preview/v22/' + url.search }); res.end(); return; }
        const prefix = '/preview/v22/';
        const file = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || 'index.html' : '';
        if (!staticFiles.has(file)) throw fail('찾을 수 없는 파일입니다.', 404);
        let data; try { data = await readFile(join(root, file)); } catch { throw fail('찾을 수 없는 파일입니다.', 404); }
        res.writeHead(200, { 'Content-Type': mime[file.split('.').pop()] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      const endpoint = pathname.slice('/preview-api'.length);
      if (req.method === 'GET' && endpoint === '/status') {
        json(res, 200, { previewOnly: true, menuVisionConfigured: Boolean(apiKey), roomStorage: 'local-memory', locationSearchConfigured: false, model: apiKey ? model : null }); return;
      }
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw fail('지원하지 않는 요청입니다.', 405);
      if (req.method !== 'GET') {
        const key = `${req.socket.remoteAddress}:${endpoint === '/menu-parse' ? 'menu' : 'rooms'}`;
        const now = Date.now(); let limit = limits.get(key);
        if (!limit || now - limit.since > 60000) { limit = {since: now, count: 0}; limits.set(key, limit); }
        if (++limit.count > (endpoint === '/menu-parse' ? 3 : 100)) throw fail('잠시 후 다시 시도해 주세요. 미리보기 요청 한도에 도달했습니다.', 429);
      }
      if (endpoint === '/menu-parse' && req.method === 'POST') {
        if (!apiKey) throw fail('사진 AI 분석은 아직 연결하지 않았습니다. 예시 메뉴 또는 직접 입력으로 체험해 주세요.', 503);
        json(res, 200, await parseMenuPhoto(await readJson(req), { apiKey, model })); return;
      }
      if (endpoint === '/rooms' && req.method === 'POST') { json(res, 201, store.create(await readJson(req))); return; }
      const match = endpoint.match(/^\/rooms\/([a-f0-9]{48})(?:\/(join|votes|decision))?$/);
      if (!match) throw fail('찾을 수 없는 요청입니다.', 404);
      const [, id, action] = match;
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (!action && req.method === 'GET') { json(res, 200, store.get(id, token)); return; }
      if (!action && req.method === 'DELETE') { json(res, 200, store.delete(id, token)); return; }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (action === 'join') { json(res, 200, store.join(id, body)); return; }
        if (action === 'votes') { json(res, 200, store.vote(id, token, body)); return; }
        if (action === 'decision') { json(res, 200, store.decide(id, token, body)); return; }
      }
      throw fail('지원하지 않는 요청입니다.', 405);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      json(res, status, {error: status === 500 ? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' : error.message});
    }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PREVIEW_PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('잘못된 미리보기 포트');
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`Local preview ready: http://127.0.0.1:${port}/preview/v22/ (no production writes)`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
