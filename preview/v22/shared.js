import { MENU_CLIENT_TIMEOUT_MS } from './menu-analysis-policy.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export const hostedTools = () => typeof document !== 'undefined' && document.documentElement.dataset.toolsMode === 'hosted';

export function apiUrl(path, hosted = hostedTools()) {
  if (!hosted) return `/preview-api${path}`;
  if (path === '/status' || path === '/menu-parse') return '/api/menu-photo';
  const match = path.match(/^\/rooms(?:\/([a-f0-9]{48})(?:\/(join|votes|decision))?)?$/);
  if (!match) throw new Error('지원하지 않는 요청입니다.');
  const query = new URLSearchParams();
  if (match[1]) query.set('id', match[1]);
  if (match[2]) query.set('action', match[2]);
  return `/api/rooms${query.size ? `?${query}` : ''}`;
}

export async function api(path, options = {}) {
  const isMenuAnalysis = path === '/menu-parse';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), isMenuAnalysis ? MENU_CLIENT_TIMEOUT_MS : 45000);
  try {
    const { body, headers, ...rest } = options;
    let accessKey = '';
    if (hostedTools()) { try { accessKey = localStorage.getItem('imm_access_key') || ''; } catch {} }
    const response = await fetch(apiUrl(path), {
      ...rest,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(accessKey ? { 'X-Imm-Key': accessKey } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    let result;
    try { result = await response.json(); } catch (parseError) {
      if (parseError.name === 'AbortError') throw parseError;
      const error = new Error(isMenuAnalysis && response.status === 504
        ? '서버가 사진 분석 응답을 기다리다 연결을 종료했습니다. 선택한 사진은 그대로 유지됩니다. 자동 재시도는 하지 않았어요. 필요하면 사진을 1~2장씩 나눠 다시 분석해 주세요.'
        : '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
      error.status = response.status || 502;
      error.code = isMenuAnalysis && response.status === 504 ? 'MENU_ANALYSIS_TIMEOUT' : 'SERVER_RESPONSE_INVALID';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(typeof result?.error === 'string' && result.error ? result.error : '요청을 처리하지 못했습니다.');
      error.status = response.status;
      if (typeof result?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(result.code)) error.code = result.code;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      const timeoutError = new Error(isMenuAnalysis
        ? '사진 분석 응답을 기다리는 시간이 초과되었습니다. 서버의 처리 완료 여부를 확인할 수 없어 자동 재시도하지 않았어요. 선택한 사진은 유지되며, 필요하면 사진을 1~2장씩 나눠 다시 분석해 주세요.'
        : '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.');
      timeoutError.status = 408;
      timeoutError.code = isMenuAnalysis ? 'MENU_CLIENT_TIMEOUT' : 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

let toastTimer;
export function notify(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = String(message);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
