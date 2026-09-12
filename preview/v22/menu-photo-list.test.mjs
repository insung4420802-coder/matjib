import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePhotoSelection,appendUniquePhotos} from './menu-photo-list.js';
import {normalizeMenu,planOrder,calculateOrder} from './menu-core.js';

const file=(size=100)=>({type:'image/png',size});
test('selection supports adding in batches up to five photos',()=>{
  assert.doesNotThrow(()=>validatePhotoSelection([],Array.from({length:5},()=>file())));
  assert.doesNotThrow(()=>validatePhotoSelection([{bytes:100},{bytes:100}],Array.from({length:3},()=>file())));
  assert.throws(()=>validatePhotoSelection([{bytes:100}],Array.from({length:5},()=>file())),/최대 5장/);
});
test('selection accepts phone originals before optimization and bounds them separately',()=>{
  assert.doesNotThrow(()=>validatePhotoSelection([],[file(20*1024*1024)]));
  assert.throws(()=>validatePhotoSelection([],[file(20*1024*1024+1)]),/장당 20MB/);
  assert.doesNotThrow(()=>validatePhotoSelection([],[{type:'image/heic',size:100}]));
  assert.doesNotThrow(()=>validatePhotoSelection([],[{type:'',name:'IMG_123.HEIC',size:100}]));
  for(const bad of [{type:'image/svg+xml',size:100},file(0),file(NaN)]) assert.throws(()=>validatePhotoSelection([],[bad]));
  assert.throws(()=>appendUniquePhotos([{image:'a',bytes:3*1024*1024}],[{image:'b',bytes:1}]),/전체 용량/);
});
test('exact duplicate images are skipped without mutating the old photo list',()=>{
  const old=[{id:'1',image:'a',bytes:10}];
  const result=appendUniquePhotos(old,[{id:'2',image:'a',bytes:10},{id:'3',image:'b',bytes:10}]);
  assert.equal(result.duplicateCount,1);assert.deepEqual(result.photos.map(x=>x.id),['1','3']);assert.equal(old.length,1);
});
test('normalization preserves page metadata and blocks unresolved prices',()=>{
  const raw={currency:'JPY',items:[{name:'소바',localName:'そば',price:850,category:'main',priceConflict:true,sourcePages:[1,2,9],priceOptions:[{price:850,currency:'JPY',pages:[1]},{price:950,currency:'JPY',pages:[2]}]}]};
  const menu=normalizeMenu(raw);assert.deepEqual(menu.items[0].sourcePages,[1,2]);assert.equal(menu.items[0].price,null);assert.equal(menu.items[0].priceOptions.length,2);
  assert.ok(planOrder({...menu,people:1,budget:1000}).error);
  assert.deepEqual(calculateOrder([{...menu.items[0],price:850}],{[menu.items[0].id]:1},'JPY',1000).unknownPrices,['소바']);
  menu.items[0].price=950;menu.items[0].priceConflict=false;assert.equal(planOrder({...menu,people:1,budget:1000}).total,950);
});
test('sixty merged menu items are not truncated back to twenty',()=>{
  const menu=normalizeMenu({currency:'JPY',items:Array.from({length:60},(_,i)=>({name:`menu${i}`,price:100}))});assert.equal(menu.items.length,60);
});
test('multi-photo UI sends only from the explicit analyze action',async()=>{
  const source=await readFile(new URL('./menu.js',import.meta.url),'utf8');
  assert.match(source,/id="menu-photo" multiple/);
  assert.match(source,/state\.photos\.map\(photo=>photo\.image\)/);
  assert.match(source,/data-action="remove-photo"/);
  const selection=source.slice(source.indexOf("if (target.id === 'menu-photo'"),source.indexOf('} else if (target.dataset.menuField)'));
  assert.equal(selection.includes("api('/menu-parse'"),false);
  assert.ok(selection.includes('invalidatePhotoResults()'));
  assert.match(source,/data-action="resolve-price"/);
  assert.match(source,/id="menu-camera" accept="image\/\*" capture="environment"/);
  assert.equal(source.includes('Promise.all(files.map(readPhoto))'),false);
  assert.match(source,/incoming.push\(await readPhoto/);
});
