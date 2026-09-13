import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMenuMeaning, invalidateMenuMeaning } from './menu.js';

test('menu-sourced explanations are immediately legible and retain their source badge',()=>{
  const html=renderMenuMeaning({description:'차갑게 낸 메밀국수를 소스에 찍어 먹는 메뉴예요.',descriptionSource:'menu'});
  assert.match(html,/메뉴판 내용 풀이/);assert.match(html,/차갑게 낸 메밀국수/);
  assert.match(html,/data-description-source="menu"/);assert.doesNotMatch(html,/<details|<summary|<img/);
  assert.doesNotMatch(html,/실제 재료·조리법과 다를/);
});

test('general food explanations clearly distinguish themselves from restaurant facts',()=>{
  const html=renderMenuMeaning({description:'보통 쌀국수에 고기와 허브를 곁들여 먹는 음식이에요.',descriptionSource:'general'});
  assert.match(html,/음식 이해를 돕는 일반 설명/);
  assert.match(html,/이 식당의 실제 재료·조리법과 다를 수 있어요/);
  assert.match(html,/data-description-source="general"/);
});

test('missing, unknown, unsupported and overlong descriptions never become inferred facts',()=>{
  for(const item of [{},{description:'',descriptionSource:'menu'},{description:'안전하게 먹어도 됩니다',descriptionSource:'unknown'},{description:'알레르기 없음',descriptionSource:'invented'},{description:'가'.repeat(81),descriptionSource:'menu'}]){
    const html=renderMenuMeaning(item);
    assert.match(html,/이름만으로는 설명하기 어려워요. 직원에게 확인해 주세요./);
    assert.match(html,/data-description-source="unknown"/);
    assert.doesNotMatch(html,/안전하게 먹어도|알레르기 없음|가{81}/);
  }
});

test('description text is escaped and source values cannot inject markup',()=>{
  assert.match(renderMenuMeaning({description:'가'.repeat(79)+'🍜',descriptionSource:'general'}),/data-description-source="general"/);
  const text='<img src=x onerror="alert(1)"> & <script>run()</script>';
  const html=renderMenuMeaning({description:text,descriptionSource:'menu'});
  assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/&quot;/);assert.match(html,/&amp;/);
  const invalid=renderMenuMeaning({description:'test',descriptionSource:'general" onclick="alert(1)'});
  assert.doesNotMatch(invalid,/onclick|alert/);assert.match(invalid,/설명 확인 필요/);
});

test('editing either name clears stale explanation without changing price or dietary fields',()=>{
  for(const field of ['name','localName']){
    const item={name:'차가운 메밀국수',localName:'ざるそば',description:'소스에 찍어 먹는 음식이에요.',descriptionSource:'general',price:800,spicy:null,category:'main'};
    const original={...item};assert.equal(invalidateMenuMeaning(item,field),item);
    assert.equal(item.description,'');assert.equal(item.descriptionSource,'unknown');
    for(const preserved of ['name','localName','price','spicy','category'])assert.equal(item[preserved],original[preserved]);
  }
  const item={description:'메뉴판의 음식 설명',descriptionSource:'menu'};
  for(const field of ['price','spicy','category'])invalidateMenuMeaning(item,field);
  assert.equal(item.description,'메뉴판의 음식 설명');assert.equal(item.descriptionSource,'menu');
});

test('card explanations stay outside collapsed edit controls and do not replace original-name orders',()=>{
  const source=readFileSync(new URL('./menu.js',import.meta.url),'utf8');
  const metadata=source.indexOf('<div class="menu-compact-meta">');
  const meaning=source.indexOf('${renderMenuMeaning(item)}');
  const details=source.indexOf('<details class="menu-edit-details"');
  assert.ok(metadata<meaning&&meaning<details);
  assert.match(source,/invalidateMenuMeaning\(item, field\)/);
  assert.match(source,/식이 제한·매움 필터의 판단 근거로 사용하지 않아요/);
  assert.match(source,/esc\(i\.localName \|\| i\.name\)/);
  assert.match(source,/<b>× \$\{i\.quantity\}<\/b>/);
});
