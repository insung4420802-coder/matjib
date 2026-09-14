import test from 'node:test';
import assert from 'node:assert/strict';
import {expandMenuTuples,parseMenuPhoto,applyMenuMeanings} from './menu-api.mjs';
import {normalizeMenuDescription,mergeMenuPages,MAX_MENU_DESCRIPTION_CHARS} from './menu-pages.js';
import {normalizeMenu,SAMPLE_MENU,planOrder} from './menu-core.js';
import {MENU_MAX_OUTPUT_TOKENS,MENU_ANALYSIS_TIMEOUT_MS} from './menu-analysis-policy.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const five=['육수를 넣은 달걀말이','だし巻き卵',850,'s',null];
const description='육수를 섞은 달걀을 말아 익힌 음식';
const seven=[...five,description,'g'];
const unlisted=['추측 번역','店主の秘密料理',850,'s',null];
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

test('four photos and sixty explained items use two Haiku stages with a combined 6000-token ceiling',async()=>{
  const payloads=[];const pages=Array.from({length:4},(_,p)=>page(p+1,Array.from({length:15},(_,i)=>[`だし巻き卵 ${p+1}-${i+1}`,850,'s',null,''])));
  const result=await parseMenuPhoto({images:Array(4).fill(png)},{apiKey:'test',fetchImpl:async(url,options)=>{
    const payload=JSON.parse(options.body);payloads.push(payload);if(payloads.length===1)return response(pages);
    const input=JSON.parse(payload.messages[0].content[0].text);
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:input.items.map(item=>[item.id,'육수를 넣은 달걀말이',description,'g'])})}]})};
  }});
  assert.equal(payloads.length,2);for(const payload of payloads){assert.equal(payload.model,'claude-haiku-4-5');assert.equal(payload.temperature,0);assert.equal(payload.max_tokens,3000);}
  assert.equal(payloads.reduce((sum,p)=>sum+p.max_tokens,0),MENU_MAX_OUTPUT_TOKENS);assert.equal(MENU_MAX_OUTPUT_TOKENS,6000);
  assert.equal(payloads[0].messages[0].content.filter(b=>b.type==='image').length,4);assert.equal(payloads[1].messages[0].content.filter(b=>b.type==='image').length,0);
  assert.equal(result.items.length,60);assert.ok(result.items.every(item=>item.description===description&&item.descriptionSource==='general'));
  for(let p=1;p<=4;p++)assert.equal(result.items.filter(item=>item.sourcePages.includes(p)).length,15);
  assert.equal(MENU_ANALYSIS_TIMEOUT_MS,120000);
});

test('legacy OCR and unknown interpretation retain raw names and unresolved prices without retry',async()=>{
  let calls=0;const result=await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>{
    calls++;if(calls===1)return response([page(1,[[...unlisted,'혼합된 잘못된 설명','g'],[...unlisted.slice(0,2),900,'s',null,42,'p']])]);
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[['menu-1','추측 이름','이름이 불확실함','u']]})}]})};
  }});
  assert.equal(calls,2);assert.equal(result.items.length,1);assert.equal(result.items[0].name,unlisted[1]);assert.equal(result.items[0].category,'unknown');assert.equal(result.items[0].descriptionSource,'unknown');assert.equal(result.items[0].description,'');assert.equal(result.items[0].priceConflict,true);
});

test('separate OCR and Korean meaning prompts do not mix tasks or send image data twice',async()=>{
  const payloads=[];await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async(url,options)=>{
    const payload=JSON.parse(options.body);payloads.push(payload);if(payloads.length===1)return response([page(1,[['だし巻き卵',850,'s',null,'卵とだしを使用']])]);
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({items:[['menu-1',five[0],description,'g']]})}]})};
  }});
  assert.equal(payloads.length,2);const [ocr,meaning]=payloads;
  assert.match(ocr.system,/한국어 번역이나 요리 의미 설명을 하지 마세요/);assert.match(ocr.system,/원문으로 최대 60자/);assert.match(ocr.system,/정확히 5개 값/);assert.match(ocr.system,/페이지별 최대 20개, 전체 최대 60개/);
  assert.match(ocr.messages[0].content.at(-1).text,/번역·요리 해석은 하지 마세요/);
  assert.match(meaning.system,/다국어 요리 통역/);assert.match(meaning.system,/사진 판독은 이미 끝났습니다/);assert.match(meaning.system,/인쇄된 설명을 일반 상식보다 우선/);
  assert.match(meaning.system,/조리 상식이 하나라도 들어가면 p가 아닌 g/);assert.match(meaning.system,/name은 originalName 그대로, description="", source=u/);
  assert.match(meaning.system,/의미·근거를 내부 점검/);assert.match(meaning.system,/점검 과정은 출력하지/);assert.match(meaning.system,/name과 description이 같은 음식을 뜻하는가/);
  assert.match(meaning.system,/가격·원문·페이지·분류·맵기를 출력하거나 수정하지/);assert.match(meaning.system,/정확히 4개 값/);
  assert.doesNotMatch(meaning.system,/白子ポン酢|もんじゃ焼き|あん肝|つくね|せせり|手羽先|とろろご飯|ひつまぶし|ししゃも|なめろう/);
  assert.match(meaning.messages[0].content.at(-1).text,/name과 description이 같은 음식을 뜻하는지 점검/);
  const input=JSON.parse(meaning.messages[0].content[0].text);assert.deepEqual(input.items,[{id:'menu-1',originalName:'だし巻き卵',printedDescriptions:['卵とだしを使用']}]);assert.ok(meaning.messages[0].content.every(block=>block.type==='text'));
});

test('meaning response IDs must be exact, complete and unique with no extra mutable fields',()=>{
  const normalized=mergeMenuPages([page(1,[object(),{...object(),localName:'そば',name:'소바'}])]);
  const valid=[['menu-1',five[0],description,'g'],['menu-2','메밀국수','메밀가루로 만든 면 요리','g']];
  for(const items of [[valid[0],valid[0]],[valid[0],['foreign-id',...valid[1].slice(1)]],[valid[0]],[valid[0],[...valid[1],850]],[valid[0],{id:'menu-2',name:'메밀국수',description:'면 요리',source:'g',price:1}]]){
    assert.throws(()=>applyMenuMeanings(normalized,{items}),error=>error.status===502&&error.code==='MENU_MEANING_FORMAT');
  }
  const reordered=applyMenuMeanings(normalized,{items:[valid[1],valid[0]]});assert.equal(reordered.items[0].name,five[0]);assert.equal(reordered.items[1].name,'메밀국수');
  for(let i=0;i<normalized.items.length;i++)for(const key of ['id','localName','price','spicy','sourcePages','priceConflict','priceOptions'])assert.deepEqual(reordered.items[i][key],normalized.items[i][key]);
  assert.equal(reordered.currency,normalized.currency);
});

test('bad optional descriptions degrade only that meaning, without corrupting OCR values',()=>{
  const normalized=mergeMenuPages([page(1,[object()])]);
  for(const [name,desc,source] of [[five[0],null,'g'],[five[0],'가'.repeat(81),'p'],['\u0000',description,'g'],['만든 이름','있으면 안 되는 설명','u']]){
    const result=applyMenuMeanings(normalized,{items:[['menu-1',name,desc,source]]});assert.equal(result.items[0].name,five[1]);assert.equal(result.items[0].description,'');assert.equal(result.items[0].descriptionSource,'unknown');assert.equal(result.items[0].category,'unknown');assert.equal(result.items[0].price,850);
  }
});

test('any incomplete or unsafe second-stage mapping safely preserves OCR without retries',async()=>{
  for(const invalid of [{items:[]},{items:[['unrelated',five[0],description,'g']]},{items:[['menu-1',five[0],description,'g',1]]},{items:[{id:'menu-1',name:five[0],description,source:'g',localName:'changed'}]}]){
    let calls=0;const result=await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>{
      calls++;return calls===1?response([page(1,[unlisted])]):{ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(invalid)}]})};
    }});
    assert.equal(calls,2);assert.equal(result.items[0].name,unlisted[1]);assert.equal(result.items[0].localName,unlisted[1]);assert.equal(result.items[0].price,850);assert.equal(result.items[0].description,'');assert.equal(result.items[0].descriptionSource,'unknown');assert.equal(result.items[0].category,'unknown');assert.deepEqual(result.items[0].sourcePages,[1]);assert.match(result.warnings.join(' '),/한국어 뜻 풀이를 완료하지 못해/);
  }
});

test('paid usage from both stages is allowlisted, summed and observed exactly once even on second failure',async()=>{
  let calls=0;const observed=[];const result=await parseMenuPhoto({images:[png]},{apiKey:'test',onUsage:value=>observed.push(value),fetchImpl:async()=>{
    calls++;if(calls===1){const first=response([page(1,[unlisted])]);return {ok:true,json:async()=>({...await first.json(),usage:{input_tokens:1200,output_tokens:900,cache_read_input_tokens:10,private_data:'ignore'}})};}
    return {ok:true,json:async()=>({stop_reason:'max_tokens',usage:{input_tokens:600,output_tokens:3000,cache_creation_input_tokens:20,private_data:'ignore'},content:[]})};
  }});
  assert.equal(calls,2);assert.equal(result.items[0].price,850);assert.equal(result.items[0].descriptionSource,'unknown');
  assert.deepEqual(observed,[{input_tokens:1800,output_tokens:3900,cache_read_input_tokens:10,cache_creation_input_tokens:20}]);
});
