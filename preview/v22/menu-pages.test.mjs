import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MENU_PHOTOS, MAX_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES, MAX_MENU_ITEMS, mergeMenuPages, normalizedMenuName } from './menu-pages.js';
import { validateMenuImages, parseMenuPhoto } from './menu-api.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const item = (overrides={})=>({name:'자루 소바',localName:'ざるそば',price:850,category:'main',spicy:false,...overrides});
const page = (number, items=[item()], currency='JPY')=>({page:number,currency,items});
const response = data=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(data)}]})});
function bytesImage(size) { const bytes=Buffer.alloc(size);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);return `data:image/png;base64,${bytes.toString('base64')}`; }

test('shared photo and item limits are explicit and independently bounded',()=>{
  assert.equal(MAX_MENU_PHOTOS,5);assert.equal(MAX_PHOTO_BYTES,2*1024*1024);assert.equal(MAX_TOTAL_PHOTO_BYTES,3*1024*1024);assert.equal(MAX_MENU_ITEMS,60);
  assert.equal(validateMenuImages({images:Array(5).fill(png)}).length,5);
  assert.equal(validateMenuImages({image:png}).length,1);
  for(const body of [null,{}, {images:[]},{images:Array(6).fill(png)},{images:png},{images:[png],image:png},{images:[null]},{images:['https://example.test/menu.png']},{images:['data:image/svg+xml;base64,PHN2Zz4=']}]) assert.throws(()=>validateMenuImages(body));
});

test('individual and aggregate decoded photo limits are both enforced',()=>{
  const full=bytesImage(MAX_PHOTO_BYTES);
  const half=bytesImage(MAX_PHOTO_BYTES/2);
  assert.equal(validateMenuImages({images:[full,half]}).length,2);
  assert.throws(()=>validateMenuImages({images:[full,half,png]}),/전체 용량/);
  assert.throws(()=>validateMenuImages({images:[bytesImage(MAX_PHOTO_BYTES+1)]}));
});

test('same name and same price merge with trustworthy page provenance',()=>{
  const merged=mergeMenuPages([page(1,[item({sourcePages:[99]})]),page(2,[item({priceOptions:[{price:1,currency:'USD',pages:[99]}]})])],{expectedPageCount:2});
  assert.equal(merged.items.length,1);assert.equal(merged.items[0].price,850);assert.equal(merged.items[0].priceConflict,false);
  assert.deepEqual(merged.items[0].sourcePages,[1,2]);assert.deepEqual(merged.items[0].priceOptions,[{price:850,currency:'JPY',pages:[1,2]}]);
  assert.deepEqual(merged.analyzedPages,[1,2]);
});

test('matching ignores only Unicode canonical form, case, and whitespace, preserving variants',()=>{
  assert.equal(normalizedMenuName(' CAFE\u0301 '),normalizedMenuName('café'));
  const merged=mergeMenuPages([page(1,[item({localName:'Soba (S)'}),item({localName:'Soba (L)',price:1000}),item({localName:'A-B'}),item({localName:'AB'})]),page(2,[item({localName:' soba (s) '})])],{expectedPageCount:2});
  assert.equal(merged.items.length,4);assert.deepEqual(merged.items[0].sourcePages,[1,2]);
  const fallback=mergeMenuPages([page(1,[item({localName:'',name:'자루 소바'})]),page(2,[item({localName:'',name:'자루소바'})])]);assert.equal(fallback.items.length,1);
});

test('different prices produce one unresolved item with every observed price option',()=>{
  const merged=mergeMenuPages([page(1),page(2,[item({price:950})])]);const dish=merged.items[0];
  assert.equal(dish.price,null);assert.equal(dish.priceConflict,true);
  assert.deepEqual(dish.priceOptions,[{price:850,currency:'JPY',pages:[1]},{price:950,currency:'JPY',pages:[2]}]);
  assert.ok(merged.warnings.some(w=>w.includes('가격이 다르거나')));
});

test('known plus unreadable price remains unresolved, not silently trusted',()=>{
  const dish=mergeMenuPages([page(1),page(2,[item({price:null})])]).items[0];
  assert.equal(dish.price,null);assert.equal(dish.priceConflict,true);assert.equal(dish.priceOptions.length,2);
  const unknown=mergeMenuPages([page(1,[item({price:null})])]).items[0];assert.equal(unknown.price,null);assert.equal(unknown.priceConflict,false);
});

test('mixed currencies never merge equal numbers as the same price or invent conversion',()=>{
  const mixed=mergeMenuPages([page(1),page(2,[item(),item({localName:'Tea',name:'차',price:2,category:'drink'})],'USD')]);
  assert.equal(mixed.currency,null);assert.ok(mixed.items.every(i=>i.price===null&&i.priceConflict));
  assert.deepEqual(mixed.items[0].priceOptions,[{price:850,currency:'JPY',pages:[1]},{price:850,currency:'USD',pages:[2]}]);
  assert.ok(mixed.warnings.some(w=>w.includes('서로 다른 통화')));
});

test('unknown currency, invalid prices, and conflicting spice/category stay conservative',()=>{
  const unknown=mergeMenuPages([page(1),page(2,[item({spicy:null,category:'side'})],null)]);
  assert.equal(unknown.currency,null);assert.equal(unknown.items[0].price,null);assert.equal(unknown.items[0].spicy,null);assert.equal(unknown.items[0].category,'unknown');
  assert.ok(unknown.warnings.some(w=>w.includes('통화가 미확인')));
  for(const price of [NaN,Infinity,-1,'850',850.5]) assert.equal(mergeMenuPages([page(1,[item({price})])]).items[0].price,null);
});

test('missing pages are disclosed without inventing source ids; duplicate or invalid ids fail',()=>{
  const partial=mergeMenuPages([page(2)],{expectedPageCount:3});assert.deepEqual(partial.items[0].sourcePages,[2]);assert.ok(partial.warnings.some(w=>w.includes('1, 3번')));
  for(const pages of [null,[page(0)],[page(4)],[page(1),page(1)],[{page:'1',items:[]}],[{page:1,items:null}]]) assert.throws(()=>mergeMenuPages(pages,{expectedPageCount:3}),e=>e.status===502);
});

test('60-item cap includes all pages round-robin and discloses truncation',()=>{
  const pages=Array.from({length:5},(_,p)=>page(p+1,Array.from({length:20},(_,i)=>item({localName:`P${p+1} Dish ${i+1}`}))));
  const merged=mergeMenuPages(pages);assert.equal(merged.items.length,60);assert.ok(merged.warnings.some(w=>w.includes('최대 60개')));
  for(let p=1;p<=5;p++) assert.equal(merged.items.filter(i=>i.sourcePages.includes(p)).length,12);
  const oversized=mergeMenuPages([page(1,Array.from({length:21},(_,i)=>item({localName:`Dish ${i}`})))]);assert.equal(oversized.items.length,20);assert.ok(oversized.warnings.some(w=>w.includes('20개')));
});

test('five images use exactly one bounded Haiku call with numbered image blocks',async()=>{
  let calls=0;const result=await parseMenuPhoto({images:Array(5).fill(png)},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');const payload=JSON.parse(options.body);
    assert.equal(payload.model,'claude-haiku-4-5');assert.equal(payload.max_tokens,6000);
    const blocks=payload.messages[0].content;assert.equal(blocks.filter(b=>b.type==='image').length,5);assert.equal(blocks[0].type,'image');
    for(let p=1;p<=5;p++)assert.ok(blocks.some(b=>b.type==='text'&&b.text.includes(`page=${p}`)));
    return response({pages:Array.from({length:5},(_,i)=>page(i+1))});
  }});assert.equal(calls,1);assert.equal(result.items.length,1);assert.deepEqual(result.items[0].sourcePages,[1,2,3,4,5]);
});

test('new images requests reject flat responses; legacy single image preserves compatibility',async()=>{
  const flat={currency:'JPY',items:[item()],warnings:[]};
  await assert.rejects(parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>response(flat)}),e=>e.status===502);
  const legacy=await parseMenuPhoto({image:png},{apiKey:'test',fetchImpl:async()=>response(flat)});assert.equal(legacy.items[0].price,850);assert.deepEqual(legacy.items[0].sourcePages,[1]);
});

test('no API key or invalid photo set makes no external request',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return response({pages:[page(1)]});};
  await assert.rejects(parseMenuPhoto({images:[png]},{fetchImpl}),e=>e.status===503);
  await assert.rejects(parseMenuPhoto({images:Array(6).fill(png)},{apiKey:'test',fetchImpl}),e=>e.status===400);assert.equal(calls,0);
});

test('invalid model page ids and truncated output fail without partial fabricated success',async()=>{
  await assert.rejects(parseMenuPhoto({images:[png,png]},{apiKey:'test',fetchImpl:async()=>response({pages:[page(3)]})}),e=>e.status===502);
  await assert.rejects(parseMenuPhoto({images:[png]},{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',content:[]})})}),e=>e.status===502);
});
