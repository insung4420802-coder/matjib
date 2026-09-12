import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SAMPLE_MENU, normalizeMenu, planOrder, calculateOrder, makeOrderCard, validPrice } from './menu-core.js';
import { validateMenuImage, parseMenuPhoto } from './menu-api.mjs';

test('sample planner stays within budget and includes one main per diner',()=>{
  const menu=normalizeMenu(SAMPLE_MENU);const result=planOrder({...menu,people:3,budget:4000,avoidSpicy:true});
  assert.equal(result.error,undefined);assert.ok(result.total<=4000);assert.equal(result.lines.filter(i=>i.category==='main').reduce((n,i)=>n+i.quantity,0),3);assert.ok(result.lines.every(i=>i.spicy===false));
});
test('unknown prices and uncertain spice are never silently eligible',()=>{
  const items=[{id:'a',name:'a',price:null,category:'main',spicy:false},{id:'b',name:'b',price:10,category:'main',spicy:null}];
  assert.ok(planOrder({items,currency:'USD',budget:20,people:1,avoidSpicy:true}).error);
  assert.equal(planOrder({items,currency:'USD',budget:20,people:1}).total,10);
});
test('missing currency, invalid headcount and insufficient budget fail clearly',()=>{
  const args={...SAMPLE_MENU,people:3,budget:100};assert.ok(planOrder(args).error);assert.ok(planOrder({...args,budget:4000,currency:null}).error);assert.ok(planOrder({...args,budget:4000,people:0}).error);
});
test('decimal currency calculations use integer minor units',()=>{
  const result=calculateOrder([{id:'a',name:'a',price:0.1},{id:'b',name:'b',price:0.2}],{a:1,b:1},'USD',0.3);
  assert.equal(result.total,0.3);assert.equal(result.withinBudget,true);assert.equal(result.remaining,0);
});
test('normalization does not coerce unknown prices or invent local names',()=>{
  const result=normalizeMenu({currency:'unknown',items:[{name:'dish',price:'200',spicy:'false'},{name:'other',price:-1},{name:'ok',price:0}]});
  assert.equal(result.currency,null);assert.equal(result.items[0].price,null);assert.equal(result.items[0].spicy,null);assert.equal(result.items[0].localName,'');assert.equal(result.items[1].price,null);assert.equal(result.items[2].price,0);
});
test('negative/oversized quantities are bounded and unknown totals flagged',()=>{
  const result=calculateOrder([{id:'a',name:'a',price:10},{id:'b',name:'b',price:null}],{a:25,b:2},'USD',100);
  assert.equal(result.total,200);assert.equal(result.lines[0].quantity,20);assert.deepEqual(result.unknownPrices,['b']);assert.equal(result.withinBudget,false);
});
test('order card preserves only verified menu names and quantity',()=>{
  assert.equal(makeOrderCard({lines:[{name:'소바',localName:'ざるそば',quantity:2}]}),'ざるそば × 2');
});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
test('menu image rejects URLs, SVG, invalid bytes and large payload',()=>{
  for(const image of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aGVsbG8=',`data:image/png;base64,${'A'.repeat(2800004)}`]) assert.throws(()=>validateMenuImage({image}));
  assert.equal(validateMenuImage({image:png}).mediaType,'image/png');
});
test('unconfigured API cannot silently fake a photo extraction',async()=>{
  let called=false;await assert.rejects(parseMenuPhoto({image:png},{fetchImpl:()=>{called=true}}),e=>e.status===503);assert.equal(called,false);
});
test('parser uses one bounded Haiku call and preserves uncertain fields',async()=>{
  let calls=0;const result=await parseMenuPhoto({image:png},{apiKey:'test',fetchImpl:async(url,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'claude-haiku-4-5');assert.equal(payload.max_tokens,6000);assert.equal(payload.messages[0].content.filter(b=>b.type==='image').length,1);
    return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({currency:'JPY',items:[{name:'소바',localName:'そば',price:null,category:'main',spicy:null}],warnings:[]})}]})};
  }});assert.equal(calls,1);assert.equal(result.items[0].price,null);assert.equal(result.items[0].spicy,null);assert.ok(result.warnings.length);
});
test('truncated OCR output is not used',async()=>{
  await assert.rejects(parseMenuPhoto({image:png},{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',content:[]})})}),e=>e.status===502);
});
test('currency precision is never rounded into an invented price',()=>{
  assert.equal(validPrice(1.3,'JPY'),false);assert.equal(validPrice(1.001,'USD'),false);assert.equal(validPrice(1.01,'USD'),true);
  const menu=normalizeMenu({currency:'JPY',items:[{name:'dish',price:1.3}]});assert.equal(menu.items[0].price,null);
  assert.ok(planOrder({...SAMPLE_MENU,people:1,budget:1000.1}).error);
  assert.deepEqual(calculateOrder([{id:'a',name:'dish',price:0.25}],{a:1},'KRW').unknownPrices,['dish']);
});
test('NaN, infinity, blank names and invalid categories cannot become main dishes',()=>{
  for(const budget of [NaN,Infinity,-10,0]) assert.ok(planOrder({...SAMPLE_MENU,people:1,budget}).error);
  for(const item of [{id:'a',name:'',price:2,category:'main'}, {id:'a',name:'a',price:Infinity,category:'main'}, {id:'a',name:'a',price:2,category:'unknown'}]) assert.ok(planOrder({items:[item],currency:'USD',people:1,budget:10}).error);
});
test('unsafe-looking ids still work without prototype mutation',()=>{
  const result=planOrder({items:[{id:'__proto__',name:'Dish',price:2,category:'main',spicy:false}],currency:'USD',people:2,budget:10});assert.equal(result.total,4);assert.equal(result.quantities.__proto__,2);
});
test('menu editor stays compact with native details, while new blank items open',async()=>{
  const source=await readFile(new URL('./menu.js',import.meta.url),'utf8');
  assert.ok(source.includes('<details class="menu-edit-details"'));
  assert.ok(source.includes('<summary>메뉴·가격 수정</summary>'));
  assert.ok(source.includes("!item.name.trim() || state.expanded.has(item.id) ? 'open' : ''"));
  assert.ok(source.includes('class="menu-compact-meta"'));
  assert.ok(source.includes('class="menu-compact-price"'));
  assert.ok(source.includes('state.expanded.add(item.id)'));
  assert.equal(source.includes('window.confirm('),false);
});
