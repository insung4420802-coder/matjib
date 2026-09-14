import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_REFERENCE_ENTRIES, findMenuReference, applyMenuReferences } from './menu-reference-meaning.js';
import { parseMenuPhoto } from './menu-api.mjs';

test('curated definitions have short Korean explanations, primary-source URLs and unique exact names', () => {
  assert.ok(MENU_REFERENCE_ENTRIES.length >= 40);
  const names = new Set();
  for (const entry of MENU_REFERENCE_ENTRIES) {
    assert.ok(entry.originals.length > 0);
    assert.match(entry.name, /[가-힣]/);
    assert.ok(Array.from(entry.description).length > 5 && Array.from(entry.description).length <= 40);
    assert.ok(entry.sources.length > 0);
    for (const source of entry.sources) assert.equal(new URL(source).protocol, 'https:');
    for (const original of entry.originals) {
      assert.ok(!names.has(original)); names.add(original);
      assert.equal(findMenuReference(original), entry);
    }
  }
});

test('dictionary does not fuzzy-match OCR errors, custom dish names, sets, sizes or AI translations', () => {
  for (const name of ['ぎるそば','月のしずくスペシャル','わらび餅セット','白子ポン酢 大','おすすめ白子ポン酢','湯葉刺し風サラダ','고기 떡',null]) assert.equal(findMenuReference(name), null);
  assert.equal(findMenuReference('  わらび餅  '),findMenuReference('わらび餅'));
});

test('known culinary mistranslations are replaced by general definitions, never restaurant evidence', () => {
  for (const [original,required,forbidden] of [
    ['白子ポン酢',/이리|정소/,/흰자|돼지|뼈/],
    ['わらび餅',/전분/,/고기/],
    ['みたらし団子',/간장/,/단호박/],
    ['湯葉刺し',/두유|두부피/,/유부/],
    ['ひじき煮',/톳/,/미역/],
    ['ほっけ開き',/임연수어|호케/,/넙치/],
    ['あんみつ',/한천/,/팥 떡/],
  ]) {
    const item={id:'m1',name:'틀린 번역',localName:original,description:'틀린 재료',descriptionSource:'menu',price:null,spicy:null,category:'unknown',priceConflict:true,sourcePages:[1,2],priceOptions:[500,550]};
    const result=applyMenuReferences({currency:'JPY',items:[item],warnings:[]});
    assert.match(result.items[0].name+' '+result.items[0].description,required);
    assert.doesNotMatch(result.items[0].name+' '+result.items[0].description,forbidden);
    assert.equal(result.items[0].descriptionSource,'general');
    for (const field of ['id','localName','price','spicy','category','priceConflict','sourcePages','priceOptions']) assert.deepEqual(result.items[0][field],item[field]);
    assert.equal(result.currency,'JPY');assert.equal(item.name,'틀린 번역');
  }
});

test('unlisted and overseas dishes preserve the model result; dictionary does not add any menu', () => {
  const result={currency:'USD',items:[{name:'와라비모치',localName:'House Special',description:'직원에게 확인',descriptionSource:'unknown',price:12}],warnings:['원문 확인']};
  assert.equal(applyMenuReferences(result),result);
});

test('a failed text interpretation can still explain an exact known dish without another paid call', async () => {
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  let calls=0;
  const result=await parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>{
    calls++;
    if(calls===2)throw new Error('network unavailable');
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({pages:[{page:1,currency:'JPY',items:[['わらび餅',550,'s',null,''],['月のしずくスペシャル',1200,'u',null,'']],warnings:[]}]})}]})};
  }});
  assert.equal(calls,2);assert.equal(result.items.length,2);
  assert.equal(result.items[0].descriptionSource,'general');assert.match(result.items[0].description,/전분/);
  assert.equal(result.items[0].price,550);assert.equal(result.items[0].category,'unknown');assert.equal(result.items[0].spicy,null);
  assert.equal(result.items[1].name,'月のしずくスペシャル');assert.equal(result.items[1].descriptionSource,'unknown');
  assert.ok(result.warnings.some(w=>w.includes('일반 용어 설명')));
});
