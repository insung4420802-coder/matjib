import { api, escapeHtml as esc, notify } from './shared.js';

const OPTIONS = [['like','좋아요'], ['okay','괜찮아요'], ['no','이번에는 싫어요']];
const KEY = 'matjib-v22-preview-room:';
const DEMO = [
  {name:'예시 · 온기 식당',menu:'수육 · 국밥',address:'가상의 식당입니다'},
  {name:'예시 · 초록 테이블',menu:'파스타 · 샐러드',address:'가상의 식당입니다'},
  {name:'예시 · 한그릇',menu:'덮밥 · 우동',address:'가상의 식당입니다'},
];
const unpack = data => data.room || data;

export function mountRooms(root, { hosted = false, candidates: initialCandidates = [] } = {}) {
  let room = null, token = '', memberId = '', busy = false, error = '', destroyed = false, revision = 0, closeActiveConfirmation = null;
  let pollPausedUntil = 0, pollFailures = 0, pollTerminal = false, refreshing = false;
  const emptyCandidates = () => hosted ? [{name:'',menu:'',address:''},{name:'',menu:'',address:''}] : DEMO.map(x=>({...x}));
  let candidates = initialCandidates.length ? initialCandidates.slice(0,5).map(c=>({name:c.name,menu:c.menu,address:c.address})) : emptyCandidates();
  while(candidates.length<2)candidates.push({name:'',menu:'',address:''});
  const params = new URLSearchParams(location.search), inviteId = params.get('room');
  let roomId = inviteId || '';
  let forcedJoin = params.get('join') === '1';
  try {
    const saved = roomId && !forcedJoin && JSON.parse(sessionStorage.getItem(KEY + roomId) || 'null');
    if (saved) {token=saved.token;memberId=saved.memberId;}
  } catch {}

  const auth = () => ({Authorization:`Bearer ${token}`});
  const visible = () => !destroyed && !document.hidden && root.isConnected && !root.hidden && !root.closest('[hidden]');
  function askConfirmation(message, confirmLabel = '확인') {
    closeActiveConfirmation?.(false);
    return new Promise(resolve=>{
      const previousFocus=document.activeElement;
      const overlay=document.createElement('div');
      overlay.dataset.roomConfirmation='true';
      Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'1000',display:'grid',placeItems:'center',padding:'20px',background:'rgba(15,23,42,.45)'});
      overlay.innerHTML=`<section class="panel stack" role="alertdialog" aria-modal="true" aria-labelledby="room-confirm-title" aria-describedby="room-confirm-message" tabindex="-1" style="width:min(100%,460px);margin:0"><h3 id="room-confirm-title">선택을 확인해 주세요</h3><p id="room-confirm-message">${esc(message)}</p><div class="row"><button class="btn btn-quiet" type="button" data-confirm-cancel>취소</button><button class="btn btn-primary" type="button" data-confirm-accept>${esc(confirmLabel)}</button></div></section>`;
      const cancel=overlay.querySelector('[data-confirm-cancel]'),accept=overlay.querySelector('[data-confirm-accept]');
      let settled=false;
      const finish=value=>{
        if(settled)return;settled=true;
        overlay.remove();document.removeEventListener('keydown',onKey,true);
        if(closeActiveConfirmation===finish)closeActiveConfirmation=null;
        if(previousFocus?.isConnected&&!previousFocus.closest('[hidden]'))previousFocus.focus();
        resolve(value);
      };
      const onKey=event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);}
        if(event.key==='Tab'){
          if(event.shiftKey&&document.activeElement===cancel){event.preventDefault();accept.focus();}
          else if(!event.shiftKey&&document.activeElement===accept){event.preventDefault();cancel.focus();}
        }
      };
      cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);
      overlay.onclick=event=>{if(event.target===overlay)finish(false);};
      closeActiveConfirmation=finish;root.append(overlay);document.addEventListener('keydown',onKey,true);cancel.focus();
    });
  }
  function saveSession(data) {
    room = data.room; roomId=room.id; token=data.memberToken;
    pollPausedUntil=0;pollFailures=0;pollTerminal=false;
    memberId=room.members[room.members.length-1].id;
    try {sessionStorage.setItem(KEY+roomId,JSON.stringify({token,memberId}));} catch {}
    forcedJoin=false;
  }
  function url(forJoin=false) {
    const next = new URL(location.href); next.search=''; next.searchParams.set('room',roomId);
    if(forJoin) next.searchParams.set('join','1'); next.hash='rooms'; return next.href;
  }
  const notice = `<div class="notice">${hosted ? '링크로 지인을 초대해 의견을 모아요. 닉네임·후보·투표는 48시간 저장 후 만료됩니다. 초대 링크를 가진 사람이 참여할 수 있으니 개인 연락처나 민감한 내용은 쓰지 마세요.' : '실제 검색과 분리된 로컬 체험입니다. 초대 링크는 이 컴퓨터에서만 열리며, 모임은 48시간 후 또는 서버 재시작 시 사라집니다.'}</div>`;
  function candidateInputs(c,i) {
    return `<div class="candidate stack" data-candidate-index="${i}"><div class="row"><strong>후보 ${i+1}</strong><button type="button" class="btn btn-quiet" data-remove="${i}" ${candidates.length<=2?'disabled':''}>삭제</button></div><label class="field">식당 이름<input name="candidate-name-${i}" value="${esc(c.name)}" maxlength="80" required placeholder="예: 식당 이름"></label><div class="grid-2"><label class="field">주요 메뉴<input name="candidate-menu-${i}" value="${esc(c.menu)}" maxlength="80" placeholder="예: 파스타"></label><label class="field">주소 또는 위치<input name="candidate-address-${i}" value="${esc(c.address)}" maxlength="160" placeholder="정확한 주소를 입력해 주세요"></label></div></div>`;
  }
  function renderCreate(keep = {}) {
    root.innerHTML=`<div class="stack">${notice}<div class="panel stack"><div><span class="eyebrow">01 · 함께 고르는 한 끼</span><h2 class="section-title">우리 뭐 먹지?</h2><p class="muted">링크 한 개로 의견을 모으고, 모두가 괜찮은 한 곳을 골라요.</p></div><form id="room-create" class="stack"><div class="grid-2"><label class="field">모임 이름<input name="title" required maxlength="60" value="${esc(keep.title||'주말 점심 어디서 먹을까?')}"></label><label class="field">내 닉네임<input name="nickname" required maxlength="20" value="${esc(keep.nickname||'모임장')}"></label></div><label class="field">모임 시간 <span class="muted">(선택)</span><input type="datetime-local" name="meetingAt" value="${esc(keep.meetingAt||'')}"></label><div class="row"><h3>식당 후보</h3><span class="badge">2~5곳</span></div><p class="muted">아래는 동작 확인을 위한 가상 예시입니다. 실제 식당 이름과 메뉴로 바꿔도 돼요.</p>${candidates.map(candidateInputs).join('')}<button type="button" class="btn btn-quiet" id="room-add" ${candidates.length>=5?'disabled':''}>+ 후보 추가</button><div id="room-error" class="error" role="alert">${esc(error)}</div><button type="submit" class="btn btn-primary" ${busy?'disabled':''}>${busy?'모임 만드는 중…':'이 후보로 모임 만들기'}</button></form></div></div>`;
    const form=root.querySelector('#room-create');
    if(hosted) form.querySelector('p.muted').textContent='검색에서 가져온 후보 또는 직접 입력한 식당을 확인해 주세요. 주소와 주요 메뉴는 직접 수정할 수 있어요.';
    const capture=()=>{const f=new FormData(form);candidates=candidates.map((_,i)=>({name:String(f.get(`candidate-name-${i}`)||''),menu:String(f.get(`candidate-menu-${i}`)||''),address:String(f.get(`candidate-address-${i}`)||'')})); return {title:String(f.get('title')||''),nickname:String(f.get('nickname')||''),meetingAt:String(f.get('meetingAt')||'')};};
    root.querySelector('#room-add').onclick=()=>{const keep=capture();candidates.push({name:'',menu:'',address:''});renderCreate(keep);};
    root.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{const keep=capture();candidates.splice(Number(el.dataset.remove),1);renderCreate(keep);});
    form.onsubmit=async e=>{
      e.preventDefault(); if(busy)return;
      const values=capture();busy=true;error='';renderCreate(values);const requestRevision=revision;
      try {
        const meetingAt=values.meetingAt?new Date(values.meetingAt).toISOString():'';
        const created=await api('/rooms',{method:'POST',body:{...values,meetingAt,candidates}});
        if(destroyed||revision!==requestRevision)return;saveSession(created);
        history.replaceState(null,'',url());busy=false;renderRoom();notify(hosted ? '모임을 만들었어요. 초대 링크를 지인에게 보내 주세요.' : '모임을 만들었어요. 다른 참여자로 들어가 투표를 체험해 보세요.');
      } catch(e){if(revision===requestRevision){error=e.message;renderCreate(values);}} finally{if(revision===requestRevision){busy=false;const b=root.querySelector('button[type="submit"]');if(b){b.disabled=false;b.textContent='이 후보로 모임 만들기';}}}
    };
  }
  function renderJoin() {
    root.innerHTML=`<div class="stack">${notice}<div class="panel stack"><span class="eyebrow">01 · 함께 고르는 한 끼</span><h2 class="section-title">모임에 초대받았어요</h2><p class="muted">본인의 닉네임으로 참여하면 식당 후보와 현재 의견을 볼 수 있어요. 같은 사람으로 다시 들어가려면 원래 참여했던 탭을 이용하세요.</p><form id="room-join" class="stack"><label class="field">내 닉네임<input name="nickname" maxlength="20" required autocomplete="off" placeholder="예: 지은"></label><div class="error" role="alert">${esc(error)}</div><button class="btn btn-primary" type="submit" ${busy?'disabled':''}>${busy?'참여하는 중…':'후보 보고 참여하기'}</button></form><button id="room-new" class="btn btn-quiet">새 모임 만들기</button></div></div>`;
    root.querySelector('#room-join').onsubmit=async e=>{
      e.preventDefault();if(busy)return;
      const form=e.currentTarget,nickname=new FormData(form).get('nickname'),requestRevision=revision,requestRoomId=roomId;
      busy=true;error='';form.querySelector('button').disabled=true;
      try{
        const joined=await api(`/rooms/${roomId}/join`,{method:'POST',body:{nickname}});
        if(destroyed||revision!==requestRevision||roomId!==requestRoomId)return;
        saveSession(joined);history.replaceState(null,'',url());busy=false;renderRoom();
      }catch(e){if(revision===requestRevision&&roomId===requestRoomId){error=e.message;renderJoin();}}
      finally{if(revision===requestRevision&&roomId===requestRoomId){busy=false;const b=root.querySelector('button[type="submit"]');if(b){b.disabled=false;b.textContent='후보 보고 참여하기';}}}
    };
    root.querySelector('#room-new').onclick=reset;
  }
  function counts(candidate) {
    const votes=room.members.map(m=>room.votes[m.id]?.[candidate.id]);
    return {like:votes.filter(v=>v==='like').length,okay:votes.filter(v=>v==='okay').length,no:votes.filter(v=>v==='no').length,pending:votes.filter(v=>!v).length};
  }
  function renderRoom() {
    if(destroyed)return;
    const me=room.members.find(m=>m.id===memberId), host=memberId===room.hostId;
    const agreed=room.candidates.filter(c=>{const x=counts(c);return x.pending===0&&x.no===0;});
    const ranked=[...room.candidates].sort((a,b)=>{const x=counts(a),y=counts(b);return Number(y.pending===0&&y.no===0)-Number(x.pending===0&&x.no===0)||x.no-y.no||y.like-x.like;});
    const chosen=room.candidates.find(c=>c.id===room.decision);
    const realChosen=chosen?.address&&!/예시|가상|실제\s*식당\s*아님/i.test(`${chosen.name} ${chosen.address}`);
    const date=room.meetingAt?new Date(room.meetingAt).toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'}):'모임 시간 미정';
    root.innerHTML=`<div class="stack">${notice}<div class="panel stack"><div class="row"><span class="eyebrow">01 · 함께 고르는 한 끼</span><span class="badge">${host?'모임장':'참여자'} · ${esc(me?.nickname||'')}</span></div><h2 class="section-title">${esc(room.title)}</h2><p class="muted">${esc(date)} · ${room.members.length}명 참여 / 최대 6명</p><div class="row">${room.members.map(m=>`<span class="badge">${esc(m.nickname)}${m.id===room.hostId?' · 방장':''}</span>`).join('')}</div><div class="row"><button class="btn btn-quiet" id="room-copy">초대 링크 복사</button><a class="btn btn-quiet" href="${esc(url(true))}" target="_blank" rel="noopener">다른 참여자로 체험 ↗</a><button class="btn btn-quiet" id="room-refresh">새로고침</button></div><p class="muted">이 컴퓨터의 다른 탭에서 참여를 체험할 수 있습니다. 화면이 보이는 동안 약 4초마다 의견을 갱신해요.</p></div>${chosen?`<div class="panel stack"><span class="eyebrow">식당 결정 완료</span><h2 class="section-title">${esc(chosen.name)}</h2><p>${esc(chosen.menu||'메뉴 정보 없음')}</p><p class="muted">${esc(chosen.address||'주소 정보 없음')} · ${esc(date)}</p>${realChosen?`<a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(chosen.name+' '+chosen.address)}">지도에서 위치 확인 ↗</a>`:''}<p class="muted">실제 예약이나 식당 연락은 이루어지지 않습니다.</p></div>`:`<div class="notice">${agreed.length?`모든 참여자가 괜찮다고 한 후보가 ${agreed.length}곳 있어요.`:'아직 모두의 의견이 모인 후보가 없어요.'} 투표하지 않은 사람은 동의한 것으로 계산하지 않습니다.</div>`}<div class="error" role="alert">${esc(error)}</div><div class="stack">${ranked.map(c=>{
      const x=counts(c),mine=room.votes[memberId]?.[c.id],consensus=x.pending===0&&x.no===0;
      return `<article class="candidate stack"><div class="row"><h3>${esc(c.name)}</h3><span class="badge">${room.decision===c.id?'최종 선택':consensus?'모두 괜찮아요':x.no?'의견이 갈려요':'투표 기다리는 중'}</span></div><p>${esc(c.menu||'메뉴 정보 없음')}</p><p class="muted">${esc(c.address||'주소 정보 없음')}</p><div class="row">${OPTIONS.map(([value,label])=>`<button class="btn ${mine===value?'btn-primary':'btn-quiet'}" data-vote="${c.id}" data-value="${value}" aria-pressed="${mine===value}" ${room.decision||busy?'disabled':''}>${label} ${x[value]}</button>`).join('')}</div><p class="muted">미응답 ${x.pending}명 · ${room.members.map(m=>`${esc(m.nickname)}: ${OPTIONS.find(([v])=>v===room.votes[m.id]?.[c.id])?.[1]||'미응답'}`).join(' / ')}</p>${host&&!room.decision?`<button class="btn ${consensus?'btn-primary':'btn-quiet'}" data-decide="${c.id}" ${!consensus||busy?'disabled':''}>${consensus?'이 식당으로 확정':'모두의 동의가 필요해요'}</button>`:''}</article>`;
    }).join('')}</div><div class="row"><button id="room-new" class="btn btn-quiet">다른 모임 만들기</button>${host?'<button id="room-delete" class="btn btn-quiet">이 모임 삭제</button>':''}<span class="muted">자동 만료: ${esc(new Date(room.expiresAt).toLocaleString('ko-KR'))}</span></div></div>`;
    if(hosted){
      root.querySelector('a[target="_blank"]').textContent='다른 참여자로 열기 ↗';
      const copyHint=[...root.querySelectorAll('p.muted')].find(p=>p.textContent.startsWith('이 컴퓨터의 다른 탭'));
      if(copyHint)copyHint.textContent='초대 링크를 지인에게 보내 주세요. 화면이 보이는 동안 약 30초마다 의견을 갱신해요. 참여했던 탭을 닫으면 본인 권한을 잃을 수 있어요.';
    }
    root.querySelector('#room-copy').onclick=async()=>{try{await navigator.clipboard.writeText(url());notify(hosted ? '초대 링크를 복사했어요. 이 링크로 지인을 초대하세요.' : '로컬 초대 링크를 복사했어요. 이 컴퓨터에서만 열 수 있어요.');}catch{error='자동 복사를 사용할 수 없어요. 주소창의 링크를 복사해 주세요.';renderRoom();}};
    root.querySelector('#room-refresh').onclick=()=>refresh(true);
    root.querySelector('#room-new').onclick=reset;
    root.querySelectorAll('[data-vote]').forEach(el=>el.onclick=()=>mutate('votes',{candidateId:el.dataset.vote,value:el.dataset.value}));
    root.querySelectorAll('[data-decide]').forEach(el=>el.onclick=async()=>{
      const candidateId=el.dataset.decide,c=room.candidates.find(c=>c.id===candidateId),requestRevision=revision,requestRoomId=roomId;
      if(!await askConfirmation(`“${c.name}”으로 확정할까요? 확정 후에는 투표를 바꿀 수 없어요.`,'식당 확정'))return;
      if(destroyed||revision!==requestRevision||roomId!==requestRoomId)return;
      mutate('decision',{candidateId});
    });
    const del=root.querySelector('#room-delete');if(del)del.onclick=async()=>{
      if(busy)return;
      const requestRevision=revision,requestRoomId=roomId;
      if(!await askConfirmation('모든 참여자의 투표와 모임을 삭제할까요? 삭제한 모임은 되돌릴 수 없어요.','모임 삭제'))return;
      if(destroyed||revision!==requestRevision||roomId!==requestRoomId)return;
      busy=true;del.disabled=true;
      try{
        await api(`/rooms/${requestRoomId}`,{method:'DELETE',headers:auth()});
        try{sessionStorage.removeItem(KEY+requestRoomId);}catch{}
        if(destroyed||revision!==requestRevision||roomId!==requestRoomId)return;
        reset();notify('모임을 삭제했어요.');
      }catch(e){if(!destroyed&&revision===requestRevision&&roomId===requestRoomId)error=e.message;}
      finally{if(!destroyed&&revision===requestRevision&&roomId===requestRoomId){busy=false;renderRoom();}}
    };
  }
  async function mutate(path,body) {
    if(busy)return;const requestRevision=++revision,requestRoomId=roomId;busy=true;error='';renderRoom();
    try{const next=unpack(await api(`/rooms/${requestRoomId}/${path}`,{method:'POST',headers:auth(),body}));if(revision===requestRevision&&roomId===requestRoomId&&!destroyed)room=next;}
    catch(e){if(revision===requestRevision&&roomId===requestRoomId)error=e.message;}
    finally{if(revision===requestRevision&&roomId===requestRoomId&&!destroyed){busy=false;renderRoom();}}
  }
  async function refresh(manual=false) {
    if(!roomId||!token||busy||destroyed||closeActiveConfirmation||refreshing||(!manual&&(pollTerminal||Date.now()<pollPausedUntil)))return;
    refreshing=true;
    const requestId=roomId,requestToken=token,requestRevision=revision;
    try{const next=unpack(await api(`/rooms/${roomId}`,{headers:auth()}));if(destroyed||roomId!==requestId||token!==requestToken||revision!==requestRevision||busy||closeActiveConfirmation)return;pollFailures=0;pollPausedUntil=0;pollTerminal=false;if(JSON.stringify(next)!==JSON.stringify(room)||manual){room=next;error='';renderRoom();}}
    catch(e){if(destroyed||roomId!==requestId||token!==requestToken||revision!==requestRevision||closeActiveConfirmation)return;pollFailures++;pollPausedUntil=Date.now()+Math.min(300000,30000*2**Math.min(pollFailures,4));pollTerminal=[401,404,410].includes(e.status);error=e.message;if(room)renderRoom();else renderJoin();}
    finally{refreshing=false;}
  }
  function reset(){revision++;closeActiveConfirmation?.(false);room=null;token='';memberId='';roomId='';error='';busy=false;candidates=emptyCandidates();const next=new URL(location.href);next.search='';next.hash='rooms';history.replaceState(null,'',next.href);renderCreate();}
  if(roomId&&token){root.innerHTML='<div class="panel">모임을 불러오는 중…</div>';refresh();}else if(roomId){renderJoin();}else{renderCreate();}
  const onCandidates=async event=>{
    const incoming=event.detail?.candidates;
    if(!Array.isArray(incoming)||!incoming.length)return;
    if(room){
      const requestRevision=revision,requestRoomId=roomId;
      if(!await askConfirmation('지금 모임은 그대로 두고, 전달받은 식당으로 새 모임을 만들까요?','새 모임 만들기'))return;
      if(destroyed||revision!==requestRevision||roomId!==requestRoomId)return;
    }
    const copied=incoming.slice(0,5).map(c=>({name:String(c.name||'').slice(0,80),menu:String(c.menu||'').slice(0,80),address:String(c.address||'').slice(0,160)}));
    while(copied.length<2)copied.push({name:'',menu:'',address:''});
    revision++;room=null;roomId='';token='';memberId='';busy=false;error='';candidates=copied;
    const next=new URL(location.href);next.search='';next.hash='rooms';history.replaceState(null,'',next.href);
    renderCreate({title:'중간 지점에서 함께 먹어요'});notify('식당 후보를 모임 만들기에 넣었어요. 후보와 시간을 확인해 주세요.');
  };
  window.addEventListener('preview:room-candidates',onCandidates);
  const interval=setInterval(()=>{if(visible()&&room&&!room.decision)refresh();},hosted?30000:4000);
  return ()=>{destroyed=true;closeActiveConfirmation?.(false);clearInterval(interval);window.removeEventListener('preview:room-candidates',onCandidates);};
}
