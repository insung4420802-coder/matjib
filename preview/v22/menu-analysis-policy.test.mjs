import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MENU_ANALYSIS_TIMEOUT_MS,MENU_HANDLER_DEADLINE_MS,MENU_CLIENT_TIMEOUT_MS,MENU_MAX_OUTPUT_TOKENS,menuAnalysisProgress} from './menu-analysis-policy.js';

test('model, handler, hosting and browser deadlines have increasing headroom',async()=>{
  const config=JSON.parse(await readFile(new URL('../../vercel.json',import.meta.url),'utf8'));
  assert.equal(MENU_ANALYSIS_TIMEOUT_MS,120000);
  assert.ok(MENU_ANALYSIS_TIMEOUT_MS<MENU_HANDLER_DEADLINE_MS);
  assert.ok(MENU_HANDLER_DEADLINE_MS<config.functions['api/menu-photo.js'].maxDuration*1000);
  assert.ok(config.functions['api/menu-photo.js'].maxDuration*1000<MENU_CLIENT_TIMEOUT_MS);
  assert.equal(config.functions['api/rooms.js'].maxDuration,30);
  assert.equal(MENU_MAX_OUTPUT_TOKENS,6000);
});
test('waiting messages describe elapsed waiting without inventing completion percentages',()=>{
  assert.match(menuAnalysisProgress(0,4),/사진 4장.*약 2분/);
  assert.match(menuAnalysisProgress(35000,4),/판독과 번역/);
  assert.match(menuAnalysisProgress(80000,4),/비용이 중복/);
  assert.match(menuAnalysisProgress(121000,4),/자동 재시도는 하지/);
  for(const elapsed of [0,35000,80000,121000])assert.equal(menuAnalysisProgress(elapsed,4).includes('%'),false);
});
