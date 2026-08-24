import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const renderBlock = html.slice(html.indexOf("function renderResults()"), html.indexOf("function escapeHtml"));

test("영업·거리·후기·가격대 정렬과 필터를 제공한다", () => {
  assert.match(html, /let resultSort = "recommended"/);
  assert.match(html, /function sortVisibleResults\(list\)/);
  assert.match(html, /resultSort === "distance"/);
  assert.match(html, /resultSort === "reviews"/);
  assert.match(html, /resultSort === "price"/);
  assert.match(html, /function hydrateDomesticOpenStatuses\(list\)/);
  assert.match(renderBlock, /영업 중만/);
  assert.match(renderBlock, /가격 전체/);
  assert.match(renderBlock, /후기 많은 순/);
  assert.match(renderBlock, /가격 낮은 순/);
});

test("정렬 함수는 실제 거리·후기 수·가격 값을 사용한다", () => {
  const start = html.indexOf("const PRICE_BUCKET =");
  const end = html.indexOf("function getVisibleResults()", start);
  const logic = html.slice(start, end);
  const context = {};
  vm.runInNewContext(
    `let resultSort = "recommended";\n${logic}\n` +
    "globalThis.sort = (mode, list) => { resultSort = mode; return sortVisibleResults(list); };",
    context,
  );
  const sample = [
    { id: "a", distance: 500, ratingCount: 20, priceLevel: "PRICE_LEVEL_EXPENSIVE", mapUrl: "https://a" },
    { id: "b", distance: 0, ratingCount: 10, priceLevel: "PRICE_LEVEL_INEXPENSIVE", mapUrl: "https://b" },
    { id: "c", distance: 200, ratingCount: 200, priceLevel: "PRICE_LEVEL_MODERATE", mapUrl: "https://c" },
  ];
  assert.deepEqual(Array.from(context.sort("distance", sample), (p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(Array.from(context.sort("reviews", sample), (p) => p.id), ["c", "a", "b"]);
  assert.deepEqual(Array.from(context.sort("price", sample), (p) => p.id), ["b", "c", "a"]);
});

test("관심 없음과 잘못된 결과 사유는 기기에 저장되고 복구할 수 있다", () => {
  assert.match(html, /const HIDDEN_KEY = "imm_hidden_places_v1"/);
  assert.match(html, /function hidePlace\(p, reason\)/);
  assert.match(html, /function restoreHiddenInCurrentResults\(\)/);
  assert.match(html, /🙈 관심 없음/);
  assert.match(html, /⚠️ 잘못된 결과/);
  for (const reason of ["메뉴 불일치", "음식점 아님", "폐업\/이전", "중복 결과"]) {
    assert.match(html, new RegExp(reason));
  }
  assert.match(renderBlock, /숨긴 곳 \$\{hiddenCount\}/);
});

test("카카오와 구글 지도 중심으로 재검색하고 기존 메뉴 변환을 재사용한다", () => {
  assert.match(html, /🔎 이 지역 재검색/);
  assert.match(html, /async function rerunSearchFromMapCenter\(lat, lng, button\)/);
  assert.match(html, /preparedConversion\.region = ""/);
  assert.match(html, /openMapAfter: true/);
  assert.match(html, /map\.getCenter\(\)/);
  assert.match(html, /nextCenter\.getLat\(\)/);
  assert.match(html, /nextCenter\.lat\(\)/);
});
