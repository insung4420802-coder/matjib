import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const renderBlock = html.slice(html.indexOf("function renderResults()"), html.indexOf("function escapeHtml"));

test("목록·지도 전환은 결과 상단에 있고 지도는 1등 카드 바로 뒤에 렌더된다", () => {
  const switchAt = renderBlock.indexOf('switchRow.className = "view-switch-row"');
  const filterAt = renderBlock.indexOf('bar.className = "filter-bar"');
  const championAt = renderBlock.indexOf('crown.className = "champ-banner"');
  const mapAt = renderBlock.indexOf('if (resultView === "map")');

  assert.ok(switchAt >= 0);
  assert.ok(switchAt < filterAt);
  assert.ok(filterAt < championAt);
  assert.ok(championAt < mapAt);
  assert.match(html, /\.view-switch-row/);
  assert.match(html, /결과 보기/);
});

test("목록 카드의 지도 버튼은 지도 영역으로 화면을 이동한다", () => {
  assert.match(html, /function scrollResultMapIntoView\(\)/);
  assert.match(html, /querySelector\("\.map-context"\) \|\| els\.results\.querySelector\("#resultMap"\)/);
  assert.match(html, /anchor\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(html, /function showPlaceOnMap\(p\)[\s\S]{0,220}scrollResultMapIntoView\(\)/);
});

test("카카오와 구글 맛집 핀은 같은 핀을 두 번 눌러야 목록으로 이동한다", () => {
  assert.equal((html.match(/let armedPlaceId = null;/g) || []).length, 2);
  assert.equal((html.match(/if \(armedPlaceId === id\)/g) || []).length, 2);
  assert.equal((html.match(/armedPlaceId = id;/g) || []).length, 2);
  assert.doesNotMatch(html, /setTimeout\(\(\) => focusPlaceFromMap/);
  assert.match(html, /같은 핀을 한 번 더 누르면 목록으로 이동/);
  assert.match(html, /첫 클릭은 평점/);
});
