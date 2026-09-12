import { mountRooms } from './rooms.js';
import { mountMenu } from './menu.js';
import { mountMeet } from './meet.js';
import { notify } from './shared.js';

window.addEventListener('unhandledrejection', event => {
  notify(`동작을 완료하지 못했습니다: ${event.reason?.message || '입력 내용을 확인해 주세요.'}`);
});

const panes = Object.fromEntries(['rooms', 'menu', 'meet'].map(key => [key, document.getElementById(`pane-${key}`)]));
const mounted = new Set();
const mounts = { rooms: mountRooms, menu: mountMenu, meet: mountMeet };

export function showTab(key) {
  if (!panes[key]) return;
  for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== key;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const selected = button.dataset.tab === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (!mounted.has(key)) {
    mounted.add(key);
    Promise.resolve(mounts[key](panes[key])).catch(error => {
      const p = document.createElement('p');
      p.className = 'notice error'; p.setAttribute('role', 'alert');
      p.textContent = `화면을 불러오지 못했습니다: ${error.message}`;
      panes[key].replaceChildren(p);
    });
  }
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));
window.addEventListener('preview:create-room', event => {
  showTab('rooms');
  window.dispatchEvent(new CustomEvent('preview:room-candidates', { detail: event.detail }));
  document.getElementById('pane-rooms').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const requested = new URL(location.href).searchParams.get('feature');
showTab(new URL(location.href).searchParams.has('room') ? 'rooms' : requested || 'rooms');
