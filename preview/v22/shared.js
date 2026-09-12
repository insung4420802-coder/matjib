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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
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
    try { result = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      const error = new Error(result.error || '요청을 처리하지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.');
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
