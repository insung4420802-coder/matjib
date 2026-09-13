import test from 'node:test';
import assert from 'node:assert/strict';
import {expandMenuTuples,parseMenuPhoto} from './menu-api.mjs';
import {normalizeMenuDescription,mergeMenuPages,MAX_MENU_DESCRIPTION_CHARS} from './menu-pages.js';
import {normalizeMenu,SAMPLE_MENU,planOrder} from './menu-core.js';
import {MENU_MAX_OUTPUT_TOKENS,MENU_ANALYSIS_TIMEOUT_MS} from './menu-analysis-policy.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const five=['육수를 넣은 달걀말이','だし巻き卵',850,'s',null];
const description='육수를 섞은 달걀을 말아 익힌 음식';
const seven=[...five,description,'g'];
const page=(number,items=[seven])=>({page:number,currency:'JPY',items,warnings:[]});
const response=pages=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({pages})}]})});
const object=(text=description,source='general')=>({name:five[0],localName:five[1],price:850,category:'side',spicy:null,description:text,descriptionSource:source});

test('seven-tuple explains meaning while preserving original name, price and unknown spice',()=>{
  const result=expandMenuTuples([page(1)])[0].items[0];
  assert.equal(result.name,'육수를 넣은 달걀말이');assert.equal(result.localName,'だし巻き卵');assert.equal(result.price,850);assert.equal(result.spicy,null);
  assert.equal(result.description,description);assert.equal(result.descriptionSource,'general');
  assert.equal(expandMenuTuples([page(1,[[...five,'달걀과 가다랑어 육수 사용','p']])])[0].items[0].descriptionSource,'menu');
});

test('bad or missing optional descriptions do not discard readable menus',()=>{
  for(const suffix of [[description], [null,'g'], [42,'p'], [{text:description},'p'], [description,null], [description,'menu'], [description,'u'], ['','p'], ['가'.repeat(81),'g']]) {
    const result=expandMenuTuples([page(1,[[...five,...suffix]])])[0].items[0];
    assert.equal(result.name,five[0]);assert.equal(result.price,850);assert.equal(result.description,'');assert.equal(result.descriptionSource,'unknown');
  }
});

test('required tuple data remains strict even when a good description is supplied',()=>{
  for(const item of [[null,...seven.slice(1)], [five[0],null,...seven.slice(2)], [five[0],five[1],'850',...seven.slice(3)], [five[0],five[1],850,'dessert',null,description,'g'], [five[0],five[1],850,'s','mild',description,'g'], [...seven,'extra']]) {
    assert.throws(()=>expandMenuTuples([page(1,[item])]),error=>error.status===502&&error.code==='MENU_OUTPUT_FORMAT');
  }
});

test('description normalization is bounded, attribution is never guessed',()=>{
  assert.equal(MAX_MENU_DESCRIPTION_CHARS,80);
  assert.deepEqual(normalizeMenuDescription('  달걀을\n말아 익힌 음식  ','general'),{description:'달걀을 말아 익힌 음식',descriptionSource:'general'});
  assert.equal(normalizeMenuDescription('가'.repeat(80),'menu').description.length,80);
  for(const source of [undefined,null,'p','g','MENU','unknown'])assert.deepEqual(normalizeMenuDescription(description,source),{description:'',descriptionSource:'unknown'});
});

test('legacy five-tuples and legacy objects remain usable with unknown description metadata',()=>{
  const expanded=expandMenuTuples([page(1,[five])]);const merged=mergeMenuPages(expanded);assert.equal(merged.items[0].price,850);assert.equal(merged.items[0].description,'');assert.equal(merged.items[0].descriptionSource,'unknown');
  const legacy={name:'회',localName:'刺身',price:900,category:'side',spicy:null};
  const result=normalizeMenu(mergeMenuPages([page(1,[legacy])]));assert.equal(result.items[0].localName,'刺身');assert.equal(result.items[0].price,900);assert.equal(result.items[0].descriptionSource,'unknown');
  const withDescription=normalizeMenu({currency:'JPY',items:[object()]});assert.equal(withDescription.items[0].description,description);assert.equal(withDescription.items[0].descriptionSource,'general');
});

test('matching descriptions and provenance are retained for duplicate menu pages',()=>{
  const result=normalizeMenu(mergeMenuPages([page(1,[object()]),page(2,[object()])]));
  assert.equal(result.items.length,1);assert.equal(result.items[0].description,description);assert.equal(result.items[0].descriptionSource,'general');assert.deepEqual(result.items[0].sourcePages,[1,2]);
});

test('conflicting text, conflicting source or missing description cannot create menu attribution',()=>{
  for(const second of [object('달걀을 얇게 부쳐 말아낸 음식'),object(description,'menu'),{...object(),description:undefined,descriptionSource:undefined}]){
    const result=mergeMenuPages([page(1,[object()]),page(2,[second])]);assert.equal(result.items[0].description,'');assert.equal(result.items[0].descriptionSource,'unknown');assert.equal(result.items[0].price,850);
  }
});

test('descriptions do not infer price, spice, servings, safety or additional dishes',()=>{
  const general={...object('보통 고추를 넣어 볶는 국수','general'),price:null,spicy:null,category:'main'};
  const result=normalizeMenu(mergeMenuPages([page(1,[general])]));assert.equal(result.items.length,1);assert.equal(result.items[0].price,null);assert.equal(result.items[0].spicy,null);
  const unknownSpice={...result.items[0],price:850};assert.ok(planOrder({items:[unknownSpice],currency:'JPY',people:1,budget:1000,avoidSpicy:true}).error);
  assert.equal(result.items[0].allergySafe,undefined);assert.equal(result.items[0].servings,undefined);
});

test('price conflicts remain unresolved even with matching meaningful descriptions',()=>{
  const result=mergeMenuPages([page(1,[object()]),page(2,[{...object(),price:950}])]);
  assert.equal(result.items[0].price,null);assert.equal(result.items[0].priceConflict,true);assert.equal(result.items[0].description,description);assert.equal(result.items[0].descriptionSource,'general');
});

test('all six sample menu descriptions are meaningful general explanations, not restaurant facts',()=>{
  const sample=normalizeMenu(SAMPLE_MENU);assert.equal(sample.items.length,6);
  for(const item of sample.items){assert.ok(item.description.length>=10&&item.description.length<=80);assert.equal(item.descriptionSource,'general');assert.notEqual(item.description,item.name);}
  assert.equal(sample.items[0].name,'차가운 메밀국수');assert.match(sample.items[0].description,/간장 소스/);
});

test('four photos and sixty explained items still use one Haiku call with 6000-token ceiling',async()=>{
  let calls=0;const pages=Array.from({length:4},(_,p)=>page(p+1,Array.from({length:15},(_,i)=>[`달걀말이 ${p+1}-${i+1}`,`だし巻き卵 ${p+1}-${i+1}`,850,'s',null,description,'g'])));
  const result=await parseMenuPhoto({images:Array(4).fill(png)},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'claude-haiku-4-5');assert.equal(payload.max_tokens,6000);assert.equal(payload.max_tokens,MENU_MAX_OUTPUT_TOKENS);assert.equal(payload.messages[0].content.filter(b=>b.type==='image').length,4);
    assert.match(payload.system,/정확히 7개 값의 배열/);assert.match(payload.system,/낱개로 직역하거나 소리만 음차하지/);assert.match(payload.system,/최대 40자/);assert.match(payload.system,/이 업장에 대한 사실이 아닙니다/);assert.match(payload.system,/알레르기 안전을 보장하지/);assert.match(payload.system,/페이지별 최대 20개, 전체 최대 60개/);return response(pages);
  }});
  assert.equal(calls,1);assert.equal(result.items.length,60);assert.ok(result.items.every(item=>item.description===description&&item.descriptionSource==='general'));
  for(let p=1;p<=4;p++)assert.equal(result.items.filter(item=>item.sourcePages.includes(p)).length,15);
  assert.equal(MENU_ANALYSIS_TIMEOUT_MS,120000);
});

test('unknown descriptions do not prevent complete parsing and no extra AI call is made',async()=>{
  let calls=0;const result=await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>{calls++;return response([page(1,[[...five,'이름이 불확실함','u'],[...five.slice(0,2),900,'s',null,42,'p']])]);}});
  assert.equal(calls,1);assert.equal(result.items.length,1);assert.equal(result.items[0].descriptionSource,'unknown');assert.equal(result.items[0].description,'');assert.equal(result.items[0].priceConflict,true);
});

test('Korean culinary prompt separates reading and meaning and repeats conservative final checks',async()=>{
  let calls=0;await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;const payload=JSON.parse(options.body);const system=payload.system;
    assert.equal(payload.temperature,0);assert.equal(payload.max_tokens,6000);
    assert.match(system,/한국어 원어민.*다국어 메뉴 통역사/);
    assert.match(system,/원문 판독과 음식 의미 해석을 구분/);
    assert.match(system,/사진에 인쇄된 설명을 일반 상식보다 우선/);
    assert.match(system,/일반 조리 상식이 하나라도 포함되면 p가 아닌 g/);
    assert.match(system,/원문을 그대로 유지하고 description="", source=u, 분류=u/);
    assert.match(system,/모르는 식재료·동물종·부위·조리법은 추측하거나 쉬운 이름에 덧붙이지/);
    assert.match(system,/출력 직전에 내부 점검/);assert.match(system,/점검 과정은 출력하지/);
    assert.match(system,/お好み焼き → 일본식 부침개/);assert.match(system,/店主の秘密プレート/);
    assert.doesNotMatch(system,/白子ポン酢|もんじゃ焼き|あん肝|つくね|せせり|手羽先|とろろご飯|ひつまぶし|ししゃも|なめろう/);
    const finalInstruction=payload.messages[0].content.at(-1).text;
    assert.match(finalInstruction,/원문·가격과/);assert.match(finalInstruction,/실제 음식 의미/);
    assert.match(finalInstruction,/이름은 원문 그대로·설명은 빈 문자열·source=u·분류=u/);
    assert.match(finalInstruction,/마지막 의미·근거 점검/);
    return response([page(1)]);
  }});assert.equal(calls,1);
});
