import { escapeHtml, notify } from './shared.js';
import { rankCandidates, referenceCenter, mapUrl } from './meet-core.js';

const stations = [
  { name: '강남역', lat: 37.4979, lng: 127.0276 },
  { name: '잠실역', lat: 37.5133, lng: 127.1001 },
  { name: '왕십리역', lat: 37.5615, lng: 127.0375 },
  { name: '사당역', lat: 37.4765, lng: 126.9816 },
  { name: '홍대입구역', lat: 37.5572, lng: 126.9254 },
];
const demos = [
  { id: 'demo-seongsu', name: '예시 A · 성수 인근', address: '실제 식당이 아닌 거리 비교용 후보', lat: 37.5445, lng: 127.0557, demo: true, menu: '한식' },
  { id: 'demo-gangnam', name: '예시 B · 강남 인근', address: '실제 식당이 아닌 거리 비교용 후보', lat: 37.4985, lng: 127.0277, demo: true, menu: '중식' },
  { id: 'demo-kondae', name: '예시 C · 건대 인근', address: '실제 식당이 아닌 거리 비교용 후보', lat: 37.5403, lng: 127.0695, demo: true, menu: '일식' },
  { id: 'demo-jamsil', name: '예시 D · 잠실 인근', address: '실제 식당이 아닌 거리 비교용 후보', lat: 37.5133, lng: 127.1001, demo: true, menu: '양식' },
];

const copy = value => JSON.parse(JSON.stringify(value));
const km = value => value < 0.1 && value > 0 ? `${Math.round(value * 1000)}m` : `${value.toFixed(1)}km`;
const e = value => escapeHtml(String(value ?? ''));

export function mountMeet(root) {
  let origins = stations.slice(0, 3).map((point, i) => ({ ...point, id: `origin-${i}`, person: `참여자 ${i + 1}`, station: String(i) }));
  let candidates = copy(demos);
  let results = [];
  let center = null;
  let error = '';
  let dirty = false;
  let serial = 10;
  let selected = new Set();
  let disposed = false;

  const calculationOrigins = () => origins.map(point => ({ ...point, name: `${point.person || '참여자'} · ${point.name || '출발지'}` }));

  function calculate() {
    try {
      results = rankCandidates(calculationOrigins(), candidates);
      center = referenceCenter(calculationOrigins());
      selected = new Set(results.slice(0, 3).map(place => place.id));
      error = '';
      dirty = false;
    } catch (err) {
      error = err.message;
      results = [];
      center = null;
    }
  }

  function originCard(origin, i) {
    return `<section class="candidate meet-origin">
      <div class="row" style="justify-content:space-between"><strong>출발지 ${i + 1}</strong><button class="btn btn-quiet" data-meet-action="remove-origin" data-id="${e(origin.id)}" ${origins.length <= 2 ? 'disabled' : ''} aria-label="출발지 ${i + 1} 삭제">삭제</button></div>
      <div class="grid-2">
        <label class="field">참여자 이름<input data-origin="${e(origin.id)}" data-key="person" value="${e(origin.person)}" maxlength="40" placeholder="예: 지은"></label>
        <label class="field">출발지 선택<select data-origin="${e(origin.id)}" data-key="station"><option value="manual" ${origin.station === 'manual' ? 'selected' : ''}>직접 좌표 입력</option>${stations.map((station, index) => `<option value="${index}" ${origin.station === String(index) ? 'selected' : ''}>${e(station.name)} · 대략 위치</option>`).join('')}</select></label>
      </div>
      <details ${origin.station === 'manual' ? 'open' : ''}><summary>장소·좌표 직접 수정</summary><div class="stack">
      <label class="field">장소 이름<input data-origin="${e(origin.id)}" data-key="name" value="${e(origin.name)}" maxlength="80" placeholder="역 또는 장소 이름"></label>
      <div class="grid-2">
        <label class="field">위도<input type="number" step="any" min="-90" max="90" data-origin="${e(origin.id)}" data-key="lat" value="${e(origin.lat)}" inputmode="decimal"></label>
        <label class="field">경도<input type="number" step="any" min="-180" max="180" data-origin="${e(origin.id)}" data-key="lng" value="${e(origin.lng)}" inputmode="decimal"></label>
      </div>
      </div></details>
      <button class="btn btn-quiet" data-meet-action="gps" data-id="${e(origin.id)}">내 현재 위치 넣기</button>
    </section>`;
  }

  function candidateCard(candidate, index) {
    return `<section class="candidate">
      <div class="row" style="justify-content:space-between"><span class="badge">${candidate.demo ? '가상 예시' : '직접 입력'} ${index + 1}</span><button class="btn btn-quiet" data-meet-action="remove-candidate" data-id="${e(candidate.id)}" aria-label="후보 ${index + 1} 삭제">삭제</button></div>
      <label class="field">후보 이름<input data-candidate="${e(candidate.id)}" data-key="name" value="${e(candidate.name)}" maxlength="80" placeholder="식당 또는 만날 장소"></label>
      <div class="grid-2">
        <label class="field">위도<input type="number" step="any" min="-90" max="90" data-candidate="${e(candidate.id)}" data-key="lat" value="${e(candidate.lat)}" inputmode="decimal"></label>
        <label class="field">경도<input type="number" step="any" min="-180" max="180" data-candidate="${e(candidate.id)}" data-key="lng" value="${e(candidate.lng)}" inputmode="decimal"></label>
      </div>
      <label class="field">주소 또는 메모<input data-candidate="${e(candidate.id)}" data-key="address" value="${e(candidate.address)}" maxlength="160" placeholder="직접 확인한 주소 또는 모임 메모"></label>
      <label class="field">메뉴 종류 · 선택<input data-candidate="${e(candidate.id)}" data-key="menu" value="${e(candidate.menu)}" maxlength="60" placeholder="예: 한식"></label>
    </section>`;
  }

  function resultCard(place, index) {
    const maxBar = Math.max(0.1, ...results.flatMap(result => result.distances.map(item => item.km)));
    return `<article class="candidate meet-result ${index === 0 ? 'meet-best' : ''}">
      <div class="row" style="justify-content:space-between"><span class="badge">${index === 0 ? '거리 균형 1순위' : `${index + 1}순위`}</span>${place.demo ? '<span class="muted">가상 예시</span>' : '<span class="muted">직접 입력 후보</span>'}</div>
      <h3>${e(place.name)}</h3>
      <p class="muted">${e(place.address || '주소 미입력')}</p>
      <div class="meet-metrics"><div><span class="muted">가장 먼 참여자</span><strong>${km(place.maximumKm)}</strong></div><div><span class="muted">평균 직선거리</span><strong>${km(place.averageKm)}</strong></div><div><span class="muted">참여자 간 거리 차이</span><strong>${km(place.spreadKm)}</strong></div></div>
      <div class="stack meet-distances" aria-label="참여자별 직선거리">${place.distances.map(item => `<div><div class="row" style="justify-content:space-between"><span>${e(item.name)}</span><strong>${km(item.km)}</strong></div><div class="meet-bar"><span style="width:${Math.max(0, Math.min(100, item.km / maxBar * 100)).toFixed(2)}%"></span></div></div>`).join('')}</div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap"><label class="meet-check"><input type="checkbox" data-meet-select="${e(place.id)}" ${selected.has(place.id) ? 'checked' : ''}> 모임 후보에 담기</label><a class="btn btn-quiet" href="${e(mapUrl(place))}" target="_blank" rel="noopener noreferrer">좌표를 Google 지도에서 보기 ↗</a></div>
    </article>`;
  }

  function render() {
    if (disposed) return;
    root.innerHTML = `<style>
      .meet-root .meet-intro{background:#eff7f4;border:1px solid #d8e9e1;border-radius:18px;padding:20px}
      .meet-root .meet-origin,.meet-root .meet-result{padding:18px}
      .meet-root .meet-editor-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px}
      .meet-root .meet-editor-grid>.candidate{display:flex;flex-direction:column;gap:10px;margin-top:0}
      .meet-root .meet-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
      .meet-root .meet-metrics strong{display:block;font-size:1.3rem;margin-top:5px}
      .meet-root .meet-metrics .muted{font-size:.76rem}
      .meet-root .meet-best{border-color:#629980;background:#f7fcf9}
      .meet-root .meet-distances{margin:16px 0;font-size:.88rem}
      .meet-root .meet-bar{height:6px;background:#e8eeea;border-radius:12px;margin-top:7px;overflow:hidden}
      .meet-root .meet-bar span{display:block;height:100%;background:#4e896e;border-radius:12px}
      .meet-root .meet-check{display:flex;align-items:center;gap:8px;font-size:.9rem}
      .meet-root .meet-check input{width:auto;min-height:20px}
      .meet-root .meet-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .meet-root details>summary{cursor:pointer;font-weight:650;padding:14px 0}
      .meet-root .meet-result h3{margin:14px 0 5px}
      .meet-root .meet-result p{margin-top:0}
    </style>
    <div class="meet-root stack">
      <div class="meet-intro"><div class="eyebrow">FAIR MEETUP · LOCAL PREVIEW</div><h2>어디서 만나야 공평할까?</h2><p>한 사람만 멀리 오지 않도록, <strong>가장 먼 사람의 직선거리</strong>가 짧은 후보부터 비교해요.</p><p class="muted">현재는 좌표 계산 시제품입니다. 식당 검색·대중교통·Google Routes는 연결하지 않았습니다. 기본 후보는 실제 식당이 아닌 가상 예시입니다.</p></div>
      <section class="panel stack"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 class="section-title">1. 출발지를 알려주세요</h3><span class="muted">2~6명 · 현재 ${origins.length}명</span></div><p class="muted">역 선택은 대략적인 좌표입니다. 직접 입력하거나 버튼을 눌러 내 위치를 사용할 수 있어요. 출발지 좌표는 서버에 보내거나 저장하지 않습니다.</p><div class="meet-editor-grid">${origins.map(originCard).join('')}</div><div class="meet-actions"><button class="btn" data-meet-action="add-origin" ${origins.length >= 6 ? 'disabled' : ''}>+ 출발지 추가</button><button class="btn btn-quiet" data-meet-action="reset">서울 예시로 다시 보기</button></div></section>
      <section class="panel stack"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 class="section-title">2. 만날 후보를 비교해요</h3><span class="muted">최대 50곳 · 현재 ${candidates.length}곳</span></div><p class="muted">이 미리보기는 입력한 후보끼리만 비교합니다. 1순위는 전체 지역의 최적 장소나 맛집 순위를 뜻하지 않습니다.</p><details><summary>후보 좌표 확인·직접 수정하기</summary><div class="meet-editor-grid">${candidates.map(candidateCard).join('') || '<p class="empty">아직 후보가 없습니다. 장소를 추가해 주세요.</p>'}</div></details><div class="meet-actions"><button class="btn" data-meet-action="add-candidate" ${candidates.length >= 50 ? 'disabled' : ''}>+ 후보 직접 추가</button><button class="btn btn-primary" data-meet-action="calculate">거리 균형 계산하기</button></div><p id="meet-dirty" class="notice" ${dirty ? '' : 'hidden'}>입력 내용이 바뀌었습니다. 다시 계산하면 결과에 반영됩니다.</p>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}</section>
      <section class="panel stack" id="meet-results"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 class="section-title">3. 모두의 거리를 한눈에</h3><span class="badge">직선거리 비교 · 이동시간 아님</span></div><p id="meet-results-stale" class="notice" ${dirty ? '' : 'hidden'}>아래는 이전 입력값으로 계산한 결과입니다. 위에서 다시 계산해 주세요.</p><p class="muted">가장 먼 사람의 거리 → 거리 차이 → 평균거리 순으로 정렬합니다. 실제 교통편과 강·도로·환승은 반영하지 않으므로 지도에서 경로를 확인해 주세요.</p>${center ? `<p class="muted">참고 중심점 ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)} · <a href="${e(mapUrl(center))}" target="_blank" rel="noopener noreferrer">지도에서 좌표 보기 ↗</a>${center.method === 'medoid' ? '<br>출발지가 지구 반대편에 있어 중심점이 유일하지 않습니다. 출발지 중 대표점을 표시했습니다.' : ''}</p>` : ''}<div class="stack">${results.map(resultCard).join('') || '<p class="empty">출발지와 후보를 입력한 뒤 계산해 주세요.</p>'}</div>${results.length ? `<div class="meet-actions"><button class="btn btn-primary" data-meet-action="create-room">선택한 후보로 모임 만들기</button><span class="muted" id="meet-selection-count">${selected.size}곳 선택 · 최대 5곳</span></div><p class="muted">가상 예시 여부와 좌표를 모임 후보에 표시합니다. 모임방에서는 투표를 체험할 수 있어요.</p>` : ''}</section>
    </div>`;
  }

  function markDirty() {
    dirty = true;
    const notice = root.querySelector('#meet-dirty');
    if (notice) notice.hidden = false;
    const stale = root.querySelector('#meet-results-stale');
    if (stale) stale.hidden = false;
  }

  function onInput(event) {
    const input = event.target;
    const key = input.dataset.key;
    if (!key) return;
    const record = input.dataset.origin ? origins.find(item => item.id === input.dataset.origin) : candidates.find(item => item.id === input.dataset.candidate);
    if (!record) return;
    record[key] = input.value;
    if (key === 'station') {
      const station = stations[Number(input.value)];
      if (input.value !== 'manual' && station) Object.assign(record, station);
      markDirty();
      render();
    } else {
      if (input.dataset.origin && ['lat', 'lng'].includes(key)) {
        record.station = 'manual';
        const stationSelect = root.querySelector(`select[data-origin="${record.id}"]`);
        if (stationSelect) stationSelect.value = 'manual';
      }
      // Editing an example does not establish a real business; retain its example label.
      markDirty();
    }
  }

  function onChange(event) {
    const id = event.target.dataset.meetSelect;
    if (!id) return;
    if (event.target.checked) {
      if (selected.size >= 5) {
        event.target.checked = false;
        notify('모임 후보는 최대 5곳까지 담을 수 있어요.');
        return;
      }
      selected.add(id);
    } else selected.delete(id);
    const count = root.querySelector('#meet-selection-count');
    if (count) count.textContent = `${selected.size}곳 선택 · 최대 5곳`;
  }

  function onClick(event) {
    const button = event.target.closest('[data-meet-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.meetAction;
    const id = button.dataset.id;
    if (action === 'calculate') {
      calculate(); render();
      root.querySelector(error ? '.error' : '#meet-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'reset') {
      origins = stations.slice(0, 3).map((point, i) => ({ ...point, id: `origin-${i}`, person: `참여자 ${i + 1}`, station: String(i) }));
      candidates = copy(demos); calculate(); render(); return;
    }
    if (action === 'add-origin' && origins.length < 6) origins.push({ id: `origin-${++serial}`, person: `참여자 ${origins.length + 1}`, name: '', lat: '', lng: '', station: 'manual' });
    if (action === 'remove-origin' && origins.length > 2) origins = origins.filter(item => item.id !== id);
    if (action === 'add-candidate' && candidates.length < 50) candidates.push({ id: `manual-${++serial}`, name: '', address: '', lat: '', lng: '', menu: '', demo: false });
    if (action === 'remove-candidate') candidates = candidates.filter(item => item.id !== id);
    if (['add-origin', 'remove-origin', 'add-candidate', 'remove-candidate'].includes(action)) {
      markDirty(); render();
      if (action === 'add-candidate') {
        const details = root.querySelector('details:has(.meet-editor-grid)');
        details.open = true;
        details.querySelectorAll('.candidate')[candidates.length - 1]?.querySelector('input')?.focus();
      }
      return;
    }
    if (action === 'gps') {
      if (!navigator.geolocation) { notify('이 브라우저에서는 위치 기능을 사용할 수 없어요. 좌표를 직접 입력해 주세요.'); return; }
      button.disabled = true;
      button.textContent = '위치 확인 중…';
      navigator.geolocation.getCurrentPosition(position => {
        if (disposed) return;
        const origin = origins.find(item => item.id === id);
        if (origin) Object.assign(origin, { name: '내 현재 위치', lat: Number(position.coords.latitude.toFixed(5)), lng: Number(position.coords.longitude.toFixed(5)), station: 'manual' });
        markDirty(); render();
        notify('현재 위치를 출발지에 넣었어요. 다시 계산해 주세요.');
      }, () => {
        if (disposed) return;
        render();
        notify('위치를 가져오지 못했어요. 브라우저 권한을 확인하거나 좌표를 직접 입력해 주세요.');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      return;
    }
    if (action === 'create-room') {
      if (dirty) { notify('입력한 내용이 바뀌었어요. 거리 균형을 다시 계산한 뒤 모임을 만들어 주세요.'); return; }
      const chosen = results.filter(place => selected.has(place.id));
      if (chosen.length < 2) { notify('함께 비교할 모임 후보를 2곳 이상 선택해 주세요.'); return; }
      const roomCandidates = chosen.map(place => ({
        id: place.id,
        name: place.demo && !place.name.startsWith('예시') ? `[가상 예시] ${place.name}` : place.name,
        address: `${place.demo ? '[실제 식당 아님] ' : ''}${place.address || '직접 입력한 장소'} · 좌표 ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)} · 가장 먼 참여자 직선 ${km(place.maximumKm)}`,
        menu: place.menu || '메뉴 미입력',
      }));
      window.dispatchEvent(new CustomEvent('preview:create-room', { detail: { candidates: roomCandidates } }));
    }
  }

  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  calculate(); render();
  return () => {
    disposed = true;
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}
