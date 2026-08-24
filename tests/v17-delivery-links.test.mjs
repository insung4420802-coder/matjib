import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("const DELIVERY_INTENT_RE =");
const end = html.indexOf("function scorePlace(", start);
const deliveryLogic = html.slice(start, end);

function deliveryContext() {
  const context = {};
  vm.runInNewContext(
    "let lastOriginalQuery = ''; let lastSearchCenter = null; let lastPreparedConversion = null;" +
    "const els = { query: { value: '' }, locInput: { value: '' } };" +
    deliveryLogic +
    "globalThis.setQuery = (value) => { lastOriginalQuery = value; };" +
    "globalThis.setLocation = (value) => { els.locInput.value = value; };" +
    "globalThis.hasIntent = hasDeliveryIntent;" +
    "globalThis.platforms = deliveryPlatformsFor;" +
    "globalThis.searchText = deliverySearchText;",
    context,
  );
  return context;
}

test("배달·딜리버리·delivery 검색에서만 배달앱 영역을 켠다", () => {
  const context = deliveryContext();
  for (const query of ["배달 떡볶이", "딜리버리 피자", "delivery sushi", "GrabFood 쌀국수"]) {
    context.setQuery(query);
    assert.equal(context.hasIntent(), true, query);
  }
  context.setQuery("분위기 좋은 파스타");
  assert.equal(context.hasIntent(), false);
});

test("국내는 배민·쿠팡이츠, 동남아는 GrabFood, 그 밖의 해외는 Uber Eats를 고른다", () => {
  const context = deliveryContext();
  assert.deepEqual(Array.from(context.platforms({}, false), (p) => p.id), ["baemin", "coupang-eats"]);
  const thailand = context.platforms({ address: "Bangkok, Thailand" }, true);
  assert.deepEqual(Array.from(thailand, (p) => p.id), ["grabfood"]);
  assert.equal(thailand[0].url, "https://food.grab.com/th/en/");
  assert.deepEqual(Array.from(context.platforms({ address: "도쿄도 시부야구 일본" }, true), (p) => p.id), ["uber-eats"]);
});

test("배달앱 검색어는 지점 구분을 위해 음식점명과 주소를 함께 쓴다", () => {
  const context = deliveryContext();
  assert.equal(
    context.searchText({ place_name: "맛있는분식 강남점", road_address_name: "서울 강남구 테헤란로 1" }),
    "맛있는분식 강남점 서울 강남구 테헤란로 1",
  );
  assert.match(html, /window\.open\(platform\.url, "_blank", "noopener,noreferrer"\)/);
  assert.match(html, /copyDeliverySearchText\(searchText\)/);
  assert.match(html, /현재 주소의 배달 가능 여부는 앱에서 최종 확인/);
});
