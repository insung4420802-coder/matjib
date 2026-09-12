import { api, escapeHtml as esc, notify, hostedTools } from './shared.js';
import { CURRENCIES, SAMPLE_MENU, normalizeMenu, planOrder, calculateOrder, formatMoney, makeOrderCard, validPrice } from './menu-core.js';
import { MAX_MENU_PHOTOS, MAX_MENU_ITEMS, mergeMenuPages } from './menu-pages.js';
import { validatePhotoSelection, appendUniquePhotos } from './menu-photo-list.js';
import { optimizeMenuPhoto, validatePhotoRequest } from './menu-photo-optimize.js';

export async function mountMenu(root) {
  const state = { items: [], currency: 'JPY', people: 3, budget: 4000, avoidSpicy: false, confirmed: false,
    photos: [], sample: false, busy: false, readingPhotos: false, photoProgress: '', configured: false, checking: true, warnings: [], error: '', quantities: null, planWarnings: [], expanded: new Set() };
  let alive = true;
  const options = (values, selected) => values.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const render = () => {
    if (!alive) return;
    const order = state.quantities ? calculateOrder(state.items, state.quantities, state.currency, state.budget) : null;
    root.innerHTML = `
      <section class="panel menu-intro">
        <div class="eyebrow">02 · 여행 중에도, 예산 안에서</div>
        <h2>메뉴판을 읽고,<br>우리 인원에 맞게 주문해요.</h2>
        <p class="muted">메뉴를 확인한 뒤 인원과 예산을 입력하면 주문 조합과 현지어 메뉴 카드를 만들어요.</p>
        <div class="row"><span class="badge">사진 → 메뉴 확인 → 주문 조합</span><span class="badge">자동 결제·예약 없음</span></div>
      </section>
      <div class="grid-2 menu-workspace">
        <section class="panel stack">
          <div class="section-title"><h3>1. 메뉴판 가져오기</h3><span class="badge">${state.photos.length} / ${MAX_MENU_PHOTOS}장</span></div>
          <label class="menu-upload field">
            <span>${state.readingPhotos ? esc(state.photoProgress || '사진을 준비하고 있어요…') : state.photos.length ? '메뉴판 사진 추가' : '메뉴판 사진 여러 장 선택'}</span>
            <input type="file" id="menu-photo" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" ${state.busy || state.photos.length >= MAX_MENU_PHOTOS ? 'disabled' : ''}>
            <small class="muted">최대 5장 · 원본 장당 20MB까지 자동 최적화<br>선택만으로는 전송되지 않아요.</small>
          </label>
          <label class="menu-upload field"><span>카메라로 한 장 촬영</span><input type="file" id="menu-camera" accept="image/*" capture="environment" ${state.busy || state.photos.length >= MAX_MENU_PHOTOS ? 'disabled' : ''}><small class="muted">한 장씩 촬영해 목록에 추가할 수 있어요. HEIC는 이 브라우저가 지원할 때 변환합니다.</small></label>
          ${state.photos.length ? `<div class="menu-photo-grid">${state.photos.map((photo,index)=>`<figure class="menu-photo-preview"><div class="menu-photo-heading"><span class="badge">사진 ${index+1}</span><button class="btn btn-quiet" data-action="remove-photo" data-id="${esc(photo.id)}" aria-label="사진 ${index+1} 삭제">삭제</button></div><button class="menu-photo-enlarge" data-action="view-photo" data-id="${esc(photo.id)}" aria-label="사진 ${index+1} 크게 보기"><img src="${esc(photo.image)}" alt="메뉴판 사진 ${index+1}: ${esc(photo.name)}"></button><figcaption class="muted">${esc(photo.name)}<br>원본 ${(photo.originalBytes/1024/1024).toFixed(2)}MB → 전송 ${(photo.bytes/1024/1024).toFixed(2)}MB${photo.warning ? `<br>${esc(photo.warning)}` : ''}</figcaption></figure>`).join('')}</div><p class="muted">최적화 후 총 ${(state.photos.reduce((sum,photo)=>sum+photo.bytes,0)/1024/1024).toFixed(2)}MB · 사진을 눌러 글씨를 확인해 주세요. 빽빽한 메뉴는 구역별로 나눠 찍으면 좋아요. 사진 추가·삭제 시 이전 메뉴 결과는 초기화됩니다.</p>` : '<div class="empty menu-photo-placeholder"><span aria-hidden="true">▤</span><strong>메뉴판이 여러 페이지여도 괜찮아요</strong><span>사진을 한 번에 고르거나, 나눠서 추가해 주세요.</span></div>'}
          <div class="notice${!state.configured && !state.checking ? ' warning' : ''}">${state.checking ? '사진 분석 연결 상태 확인 중…' : state.configured ? `전체 분석을 누르면 선택한 사진 모두가 Claude API로 한 번에 전송됩니다. 앱에는 사진을 저장하지 않습니다.${hostedTools() ? ` 비용 보호를 위해 앱 전체 월 ${esc(state.monthlyLimit || 20)}회까지 분석합니다. 기존 검색 API 비용과는 별도입니다.` : ' 사진이 많을수록 분석 비용이 늘어날 수 있어요.'}` : esc(state.connectionMessage || '사진 선택·추가·삭제는 체험할 수 있지만, 실제 AI 분석은 아직 연결하지 않았어요. 아래 예시 메뉴로 중복 정리와 가격 확인 흐름을 볼 수 있어요.')}</div>
          ${state.configured ? `<button class="btn btn-primary" data-action="analyze" ${!state.photos.length || state.busy ? 'disabled' : ''}>${state.busy ? state.readingPhotos ? '사진 준비 중…' : '전체 메뉴를 읽고 있어요…' : `사진 ${state.photos.length}장 전체 분석 · Claude로 전송`}</button>` : ''}
          <div class="row"><button class="btn btn-quiet" data-action="sample" ${state.busy ? 'disabled' : ''}>예시 메뉴로 체험</button><button class="btn btn-quiet" data-action="sample-pages" ${state.busy ? 'disabled' : ''}>여러 페이지 예시</button><button class="btn btn-quiet" data-action="manual" ${state.busy ? 'disabled' : ''}>직접 입력하기</button>${state.photos.length ? '<button class="btn btn-quiet" data-action="clear-photos">사진 전체 지우기</button>' : ''}</div>
        </section>
        <section class="panel stack">
          <div class="section-title"><h3>2. 인원과 예산</h3><span class="badge">추가 AI 호출 없이 계산</span></div>
          <div class="grid-2">
            <label class="field"><span>함께 먹는 인원</span><select id="menu-people">${options(Array.from({length:8},(_,i)=>[i+1,`${i+1}명`]),state.people)}</select></label>
            <label class="field"><span>메뉴판 통화</span><select id="menu-currency"><option value=""${!state.currency ? ' selected' : ''}>통화 확인 필요</option>${options(CURRENCIES.map(v=>[v,v]),state.currency)}</select></label>
          </div>
          <label class="field"><span>전체 식사 예산 (${esc(state.currency || '통화 선택')})</span><input id="menu-budget" type="number" min="1" max="100000000" step="any" inputmode="decimal" value="${esc(state.budget)}"><small class="muted">원화 환산이 아닌 메뉴판과 같은 통화예요.</small></label>
          <label class="menu-check"><input id="menu-spicy" type="checkbox" ${state.avoidSpicy ? 'checked' : ''}><span>매운 메뉴 제외<small class="muted">매움이 미확인인 메뉴도 제외합니다.</small></span></label>
          <div class="notice">주요리 1개를 1인분으로 가정합니다. 양은 식당에 확인해 주세요. 세금·봉사료·팁은 포함되지 않으며 알레르기 안전을 판정하지 않아요.</div>
          <div class="menu-budget-visual"><span class="muted">1인당 단순 예산</span><strong>${formatMoney(Number.isFinite(state.budget) ? state.budget / state.people : 0, state.currency)}</strong><span class="muted">${state.people}명이 함께 · 동일 통화 기준</span></div>
        </section>
      </div>
      ${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ''}
      <section class="panel stack" id="menu-editor">
        <div class="section-title"><h3>3. 메뉴와 가격 확인</h3>${state.sample ? '<span class="badge">가상의 예시 메뉴 · 선택한 사진의 분석 결과 아님</span>' : `<span class="badge">${state.items.length}개 · 최대 ${MAX_MENU_ITEMS}개</span>`}</div>
        ${state.warnings.map(w=>`<div class="notice">${esc(w)}</div>`).join('')}
        ${state.items.length ? `<div class="menu-item-list">${state.items.map((item,index)=>`
          <article class="candidate menu-item" data-item="${esc(item.id)}">
            <div class="section-title"><strong>${index+1}. ${esc(item.name || '메뉴 이름 입력')}</strong><div class="row"><strong class="menu-compact-price">${validPrice(item.price,state.currency) ? formatMoney(item.price,state.currency) : '가격 미확인'}</strong><button class="btn btn-quiet" data-action="remove" data-id="${esc(item.id)}" aria-label="${esc(item.name || '메뉴')} 삭제">삭제</button></div></div>
            <div class="menu-compact-meta"><span>${esc(item.localName || '원문 이름 미입력')}</span><span>${esc({main:'주요리',side:'곁들임',drink:'음료',unknown:'종류 미확인'}[item.category] || '종류 미확인')} · ${item.spicy === true ? '매움' : item.spicy === false ? '맵지 않음 확인' : '매움 미확인'}</span></div>
            ${item.sourcePages?.length ? `<span class="muted">${state.sample ? '예시 ' : ''}사진 ${item.sourcePages.join(', ')}에서 확인${item.sourcePages.length>1?' · 같은 이름의 메뉴를 합쳤어요':''}</span>` : ''}
            ${item.priceConflict ? `<div class="notice menu-price-conflict"><strong>가격 확인이 필요해요</strong><p>같은 이름의 가격이 다르거나 일부 사진에서 확인되지 않았어요. 원본의 크기·세트·시간대도 확인하고 사용할 가격을 골라 주세요.</p><div class="row">${(item.priceOptions||[]).map((option,oi)=>`<button class="btn" data-action="resolve-price" data-id="${esc(item.id)}" data-option="${oi}" ${option.currency!==state.currency || !validPrice(option.price,state.currency) ? 'disabled' : ''}>${formatMoney(option.price,option.currency)} · 사진 ${option.pages?.join(', ')||'미확인'}</button>`).join('')}</div>${!state.currency?'<p>메뉴판 통화를 먼저 확인해 주세요. 서로 다른 통화는 자동 환산하지 않습니다.</p>':''}<small>해결 전에는 이 메뉴를 주문 조합에서 제외합니다. 아래에서 가격을 직접 수정해도 됩니다.</small></div>` : ''}
            <details class="menu-edit-details" data-edit-id="${esc(item.id)}" ${!item.name.trim() || state.expanded.has(item.id) ? 'open' : ''}>
              <summary>메뉴·가격 수정</summary>
              <div class="menu-edit-fields">
                <div class="grid-2"><label class="field"><span>한국어 메뉴명</span><input data-menu-field="name" data-id="${esc(item.id)}" value="${esc(item.name)}" maxlength="100" placeholder="예: 자루 소바"></label><label class="field"><span>메뉴판 원문 이름</span><input data-menu-field="localName" data-id="${esc(item.id)}" value="${esc(item.localName)}" maxlength="120" placeholder="예: ざるそば"></label></div>
                <div class="menu-item-details"><label class="field"><span>가격 (${esc(state.currency || '?')})</span><input type="number" min="0" max="100000000" step="any" data-menu-field="price" data-id="${esc(item.id)}" value="${item.price === null ? '' : esc(item.price)}" placeholder="확인 후 입력" inputmode="decimal"></label><label class="field"><span>종류</span><select data-menu-field="category" data-id="${esc(item.id)}">${options([['main','주요리'],['side','곁들임'],['drink','음료'],['unknown','미확인']],item.category)}</select></label><label class="field"><span>매운 정도</span><select data-menu-field="spicy" data-id="${esc(item.id)}">${options([['unknown','미확인'],['false','맵지 않음 확인'],['true','매움']],String(item.spicy ?? 'unknown'))}</select></label></div>
              </div>
            </details>
            ${!validPrice(item.price,state.currency) ? '<small class="error">가격 또는 소수 자릿수 확인 필요: 주문 조합에서 제외돼요.</small>' : ''}
          </article>`).join('')}</div>` : '<div class="empty">예시 메뉴를 불러오거나 메뉴판의 메뉴와 가격을 직접 입력해 주세요.</div>'}
        <button class="btn btn-quiet" data-action="add" ${state.items.length >= MAX_MENU_ITEMS || state.busy ? 'disabled' : ''}>＋ 메뉴 추가</button>
        <label class="menu-check"><input id="menu-confirm" type="checkbox" ${state.confirmed ? 'checked' : ''} ${!state.items.length ? 'disabled' : ''}><span>메뉴명·통화·가격·종류를 확인했어요<small class="muted">${state.sample ? '가상의 예시 메뉴로 주문 조합을 체험합니다.' : 'AI 분석 결과는 틀릴 수 있어요. 위 정보를 수정하면 다시 확인해야 합니다.'}</small></span></label>
        <button class="btn btn-primary" data-action="plan" ${!state.confirmed || !state.items.length || state.busy ? 'disabled' : ''}>우리 예산으로 주문 조합 만들기</button>
      </section>
      ${order ? `<section class="panel stack menu-order" id="menu-order"><div class="section-title"><div><div class="eyebrow">OUR ORDER</div><h3>이렇게 주문해 볼까요?</h3></div><span class="badge">${state.sample ? '가상 메뉴 체험' : '확인한 메뉴 기준'}</span></div>
        ${order.lines.map(item=>`<div class="menu-order-line"><div><strong>${esc(item.name)}</strong><small class="muted">${esc(item.localName || '원문 이름 미입력')} · ${formatMoney(item.price,state.currency)}</small></div><div class="row"><label class="field"><span class="sr-only">${esc(item.name)} 수량</span><input aria-label="${esc(item.name)} 수량" type="number" min="0" max="20" value="${item.quantity}" data-quantity="${esc(item.id)}"></label><strong>${formatMoney(item.subtotal,state.currency)}</strong></div></div>`).join('')}
        ${!order.lines.length ? '<div class="empty">선택된 메뉴가 없어요. 조합을 다시 만들거나 아래 메뉴를 추가해 주세요.</div>' : ''}
        <div class="row"><label class="field"><span>다른 메뉴 추가</span><select id="order-add-item"><option value="">메뉴를 선택하세요</option>${state.items.filter(i=>i.name.trim() && validPrice(i.price,state.currency)).map(i=>`<option value="${esc(i.id)}">${esc(i.name)} · ${formatMoney(i.price,state.currency)}${state.avoidSpicy && i.spicy !== false ? ' (매움 조건 불충족)' : ''}</option>`).join('')}</select></label></div>
        <div class="menu-total"><span>예상 메뉴 합계</span><strong>${formatMoney(order.total,state.currency)}</strong><span class="${order.withinBudget ? 'muted' : 'error'}">${order.withinBudget ? `예산보다 ${formatMoney(order.remaining,state.currency)} 적어요` : `예산보다 ${formatMoney(-order.remaining,state.currency)} 많아요`}</span></div>
        ${state.avoidSpicy && order.lines.some(i=>i.spicy !== false) ? '<div class="notice error">수정한 조합에 매운 메뉴 또는 매움 미확인 메뉴가 포함되어 있어요.</div>' : ''}
        ${order.lines.filter(i=>i.category==='main').reduce((sum,i)=>sum+i.quantity,0) < state.people ? '<div class="notice">주요리 수량이 인원보다 적어요. 양을 확인해 주세요.</div>' : ''}
        ${state.planWarnings.map(w=>`<small class="muted">${esc(w)}</small>`).join('')}
        <div class="row"><button class="btn btn-primary" data-action="card" ${!order.lines.length ? 'disabled' : ''}>직원에게 주문 카드 보여주기</button><button class="btn btn-quiet" data-action="copy" ${!order.lines.length ? 'disabled' : ''}>주문 목록 복사</button></div>
      </section>` : ''}
      <dialog class="menu-order-dialog" id="menu-card"><div class="stack"><div class="section-title"><h3>Order</h3><button class="btn btn-quiet" data-action="close-card" aria-label="주문 카드 닫기">닫기 ✕</button></div>${state.sample ? '<span class="badge">SAMPLE · 가상 메뉴입니다</span>' : ''}<p class="muted">메뉴판 원문과 수량을 보여주는 카드예요. 실제 주문 내용은 직원과 확인해 주세요.</p>${order?.lines.some(i=>!i.localName) ? '<div class="notice">원문 이름이 없는 메뉴는 한국어 이름으로 표시됩니다. 메뉴판 원문 이름을 입력하면 더 쉽게 전달할 수 있어요.</div>' : ''}<div class="menu-card-lines">${order ? order.lines.map(i=>`<div><strong>${esc(i.localName || i.name)}</strong><b>× ${i.quantity}</b></div>`).join('') : ''}</div><div class="menu-total"><span>Menu subtotal · tax / service excluded</span><strong>${order ? formatMoney(order.total,state.currency) : ''}</strong></div></div></dialog>
      <dialog id="menu-photo-detail" class="menu-photo-detail" aria-label="최적화한 메뉴판 사진 확인"><div class="section-title"><strong>전송할 사진의 글씨 확인</strong><button class="btn" data-action="close-photo">닫기</button></div><p class="muted">작은 화면에서는 좌우로 움직여 전체 사진을 확인해 주세요.</p><div class="menu-photo-scroll"><img alt=""></div></dialog>
    `;
    if(state.busy) root.querySelectorAll('input,select,button[data-action]').forEach(control=>{control.disabled=true;});
  };
  const invalidate = () => { state.confirmed = false; state.quantities = null; state.error = ''; };
  const invalidatePhotoResults = () => {
    state.items=[]; state.sample=false; state.warnings=[]; state.expanded=new Set(); state.planWarnings=[]; invalidate();
  };
  async function readPhoto(file) {
    const result=await optimizeMenuPhoto(file);
    const image = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('사진을 불러오지 못했습니다.'));reader.readAsDataURL(result.blob);});
    return {id:crypto.randomUUID(),image,name:file.name,bytes:result.blob.size,originalBytes:result.originalBytes,width:result.width,height:result.height,warning:result.warning};
  }
  const addItem = () => { state.items.push({id:crypto.randomUUID(), name:'',localName:'',price:null,category:'unknown',spicy:null}); invalidate(); };
  root.addEventListener('toggle', event => {
    const detail=event.target;
    if(!detail.dataset?.editId || !root.contains(detail)) return;
    if(detail.open) state.expanded.add(detail.dataset.editId); else state.expanded.delete(detail.dataset.editId);
  }, true);
  root.addEventListener('change', async event => {
    if(state.busy) return;
    const target = event.target;
    if (target.id === 'menu-photo' || target.id === 'menu-camera') {
      const files = Array.from(target.files || []); if (!files.length) return;
      try { validatePhotoSelection(state.photos, files); } catch(error) {state.error=error.message;render();return;}
      state.busy=true;state.readingPhotos=true;state.error='';render();
      try {
        const incoming=[];
        for(let index=0;index<files.length;index++) {
          state.photoProgress=`사진 ${index+1}/${files.length}장 최적화 중…`;render();
          incoming.push(await readPhoto(files[index]));if(!alive)return;
        }
        const added=appendUniquePhotos(state.photos,incoming);
        if(added.photos.length!==state.photos.length) {state.photos=added.photos;invalidatePhotoResults();}
        if(added.duplicateCount) notify(`이미 선택한 같은 사진 ${added.duplicateCount}장은 중복 추가하지 않았어요.`);
      } catch(error) {state.error=error.message||'사진을 불러오지 못했습니다. 기존 사진은 그대로 유지됩니다.';}
      finally {state.busy=false;state.readingPhotos=false;state.photoProgress='';render();}
    } else if (target.dataset.menuField) {
      const item=state.items.find(i=>i.id===target.dataset.id); if(!item)return;
      state.expanded.add(item.id);
      const field=target.dataset.menuField;
      item[field]=field==='price' ? (target.value==='' || !Number.isFinite(Number(target.value)) || Number(target.value)<0 || Number(target.value)>100000000 ? null : Number(target.value)) : field==='spicy' ? (target.value==='unknown' ? null : target.value==='true') : target.value;
      if(field==='price' && state.currency && validPrice(item.price,state.currency)) item.priceConflict=false;
      invalidate();render();
    } else if (target.dataset.quantity) {
      state.quantities[target.dataset.quantity]=Math.max(0,Math.min(20,Math.floor(Number(target.value)||0))); render();
    } else if(target.id==='order-add-item' && target.value) {
      state.quantities[target.value]=Math.min(20,(state.quantities[target.value]||0)+1); render();
    } else if(target.id==='menu-currency') {state.currency=target.value||null;invalidate();render();}
    else if(target.id==='menu-people') {state.people=Number(target.value);state.quantities=null;render();}
    else if(target.id==='menu-budget') {state.budget=Number(target.value);state.quantities=null;render();}
    else if(target.id==='menu-spicy') {state.avoidSpicy=target.checked;state.quantities=null;render();}
    else if(target.id==='menu-confirm') {state.confirmed=target.checked;if(!state.confirmed)state.quantities=null;render();}
  });
  root.addEventListener('click', async event => {
    const button=event.target.closest('[data-action]'); if(!button||button.disabled||state.busy)return;
    const action=button.dataset.action;
    if(action==='sample') {const sample=normalizeMenu(structuredClone(SAMPLE_MENU));Object.assign(state,sample,{sample:true,confirmed:false,quantities:null,budget:4000,error:'',expanded:new Set()});render();}
    else if(action==='sample-pages') {
      const source=structuredClone(SAMPLE_MENU);
      const sample=normalizeMenu(mergeMenuPages([
        {page:1,currency:'JPY',items:source.items.slice(0,3)},
        {page:2,currency:'JPY',items:[source.items[0],{...source.items[1],price:1350},source.items[3]]},
        {page:3,currency:'JPY',items:source.items.slice(4)},
      ],{expectedPageCount:3}));
      sample.warnings.unshift('가상의 3페이지 메뉴입니다. 선택한 사진을 읽은 결과가 아닙니다. 자루 소바는 중복을 합치고, 새우튀김 소바의 서로 다른 가격은 확인을 요청합니다.');
      Object.assign(state,sample,{sample:true,confirmed:false,quantities:null,budget:4000,error:'',expanded:new Set()});render();
    }
    else if(action==='manual') {Object.assign(state,{items:[],sample:false,warnings:[],currency:'JPY',expanded:new Set()});addItem();render();}
    else if(action==='add') {if(state.items.length<MAX_MENU_ITEMS)addItem();render();}
    else if(action==='remove') {state.items=state.items.filter(i=>i.id!==button.dataset.id);invalidate();render();}
    else if(action==='remove-photo') {state.photos=state.photos.filter(photo=>photo.id!==button.dataset.id);invalidatePhotoResults();render();}
    else if(action==='clear-photos') {state.photos=[];invalidatePhotoResults();render();}
    else if(action==='view-photo') {
      const photo=state.photos.find(photo=>photo.id===button.dataset.id);if(!photo)return;
      const dialog=root.querySelector('#menu-photo-detail');const img=dialog.querySelector('img');img.src=photo.image;img.alt=photo.name;dialog.showModal();
    }
    else if(action==='close-photo') root.querySelector('#menu-photo-detail')?.close();
    else if(action==='resolve-price') {
      const item=state.items.find(item=>item.id===button.dataset.id);
      const option=item?.priceOptions?.[Number(button.dataset.option)];
      if(!option || !state.currency || option.currency!==state.currency || !validPrice(option.price,state.currency)) return;
      item.price=option.price;item.priceConflict=false;invalidate();render();notify('사용할 가격을 반영했어요. 메뉴 정보를 확인한 뒤 주문 조합을 만들어 주세요.');
    }
    else if(action==='analyze') {
      if(!state.configured||!state.photos.length||state.busy)return;
      state.busy=true;state.error='';render();
      try {const result=normalizeMenu(await api('/menu-parse',{method:'POST',body:validatePhotoRequest(state.photos.map(photo=>photo.image))}));if(!result.items.length)throw new Error('읽을 수 있는 메뉴가 없습니다.');Object.assign(state,result,{sample:false,confirmed:false,quantities:null,expanded:new Set()});notify('읽힌 메뉴를 합쳤어요. 누락 안내와 출처 사진·가격을 확인해 주세요.');}
      catch(error){state.error=error.message||'사진을 분석하지 못했습니다.';}
      finally{state.busy=false;render();}
    } else if(action==='plan') {
      if(!state.confirmed)return;
      const result=planOrder(state);state.error=result.error||'';state.planWarnings=result.warnings||[];state.quantities=result.quantities||null;render();
      if(!result.error)root.querySelector('#menu-order')?.scrollIntoView({behavior:'smooth',block:'start'});
    } else if(action==='card') root.querySelector('#menu-card')?.showModal();
    else if(action==='close-card') root.querySelector('#menu-card')?.close();
    else if(action==='copy') {
      const order=calculateOrder(state.items,state.quantities,state.currency,state.budget);
      try {await navigator.clipboard.writeText(`${state.sample?'[가상 예시 메뉴]\n':''}${makeOrderCard(order)}\n\n${formatMoney(order.total,state.currency)} (세금·봉사료 제외)`);notify('주문 목록을 복사했어요.');} catch {notify('복사 권한이 없어 주문 카드를 열었어요.');root.querySelector('#menu-card')?.showModal();}
    }
  });
  render();
  try { const status=await api('/status');state.configured=status.menuVisionConfigured===true;state.monthlyLimit=status.menuMonthlyLimit;state.connectionMessage=hostedTools()&&!state.configured?'사진 분석 연결이 준비되지 않았습니다. 예시 메뉴 또는 직접 입력을 이용해 주세요.':''; } catch(error) {state.configured=false;state.connectionMessage=error.status===401?'접근 코드가 필요합니다. 맛집 검색 화면에서 먼저 접근 코드를 입력한 후 이 화면을 다시 열어 주세요.':hostedTools()?'사진 분석 연결을 확인하지 못했습니다. 잠시 후 새로고침하거나 직접 입력을 이용해 주세요.':'';}
  finally {state.checking=false;render();}
  return () => {alive=false;};
}
