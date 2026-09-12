export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const { body, headers, ...rest } = options;
    const response = await fetch(`/preview-api${path}`, {
      ...rest,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const result = await response.json();
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
