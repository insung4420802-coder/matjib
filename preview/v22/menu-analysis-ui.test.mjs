import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('./menu.js',import.meta.url),'utf8');
test('analysis progress updates only small text nodes, not the whole menu workspace',()=>{
  const progress=source.slice(source.indexOf('const updateAnalysisProgress ='),source.indexOf('const options ='));
  assert.match(progress,/textContent/);assert.match(progress,/menuAnalysisProgress\(elapsedMs, state.photos.length\)/);
  assert.doesNotMatch(progress,/render\(|innerHTML/);
  assert.match(source,/setInterval\(updateAnalysisProgress,1000\)/);
  assert.match(source,/같은 탭을 유지/);assert.match(source,/약 2분까지/);
  assert.doesNotMatch(source,/progressbar|aria-valuenow/);
});
test('analysis timer is cleaned on completion and unmount, with photos preserved on errors',()=>{
  const analysis=source.slice(source.indexOf("else if(action==='analyze')"),source.indexOf("} else if(action==='plan')"));
  assert.match(analysis,/finally\{\s*stopAnalysisProgress\(\);/);
  assert.match(analysis,/if\(!alive\)return/);
  assert.match(source,/return \(\) => \{alive=false;stopAnalysisProgress\(\);\};/);
  assert.doesNotMatch(analysis,/state\.photos\s*=/);
  assert.equal((analysis.match(/api\('\/menu-parse'/g)||[]).length,1);
  assert.match(source,/state\.busy\) root\.querySelectorAll\('input,select,button\[data-action\]'/);
});
test('analysis errors are displayed immediately beside the analyze control',()=>{
  const analyzeButton=source.indexOf('data-action="analyze"');
  const errorBlock=source.indexOf('id="menu-analysis-error"');
  const examples=source.indexOf('data-action="sample"');
  assert.ok(analyzeButton<errorBlock&&errorBlock<examples);
  assert.match(source,/menu-analysis-error'\)\?\.scrollIntoView/);
});
test('photo and camera choosers stay disabled until connection-status rendering is finished',()=>{
  for(const id of ['menu-photo','menu-camera']){
    const input=source.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(input,`${id} exists`);
    assert.match(input,/state\.checking \|\| state\.busy/);
  }
  assert.match(source,/확인이 끝나면 사진을 선택할 수 있어요/);
  assert.match(source,/if \(target\.id === 'menu-photo' \|\| target\.id === 'menu-camera'\) \{\s*if\(state\.checking\)return;/);
  assert.match(source,/finally \{state\.checking=false;render\(\);\}/);
});
