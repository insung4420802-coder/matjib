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
    "globalThis.evidence = deliveryEvidenceFor;" +
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

test("국내 배달앱 버튼은 제거하고 동남아 GrabFood·그 밖의 해외 Uber Eats만 연결한다", () => {
  const context = deliveryContext();
  assert.deepEqual(Array.from(context.platforms({}, false)), []);
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
  assert.doesNotMatch(deliveryLogic, /https:\/\/www\.baemin\.com\//);
  assert.doesNotMatch(deliveryLogic, /https:\/\/www\.coupangeats\.com\//);
  assert.doesNotMatch(deliveryLogic, /baemin:\/\//);
  assert.doesNotMatch(deliveryLogic, /share\.coupangeats\.com/);
  assert.match(html, /if \(!overseas && evidence\.source !== "reviews"\) return/);
  assert.match(html, /deliveryInfoOnly/);
  assert.match(html, /window\.open\(platform\.url, "_blank", "noopener,noreferrer"\)/);
  assert.match(html, /copyDeliverySearchText\(searchText\)/);
  assert.match(html, /현재 가능 여부는 이용 중인 배달앱에서 확인/);
});

test("일반 검색도 후기의 확실한 배달 근거가 있으면 음식점별로 배달앱을 노출한다", () => {
  const context = deliveryContext();
  context.setQuery("맛있는 떡볶이");
  const platformMention = {
    _imm: { verified: true, realReviews: [{ title: "저녁 메뉴", description: "배민으로 주문해서 맛있게 먹었어요", link: "a" }] },
  };
  assert.equal(context.evidence(platformMention, false).source, "reviews");

  const repeatedGeneric = {
    _imm: { verified: true, realReviews: [
      { title: "후기 1", description: "배달 포장 상태가 괜찮았어요", link: "a" },
      { title: "후기 2", description: "배달 메뉴도 먹어봤어요", link: "b" },
    ] },
  };
  assert.equal(context.evidence(repeatedGeneric, false).mentionCount, 2);
});

test("배달 불가 후기와 단순 1회 언급은 배달 가능 근거로 오인하지 않는다", () => {
  const context = deliveryContext();
  context.setQuery("맛있는 피자");
  const negative = {
    _imm: { verified: true, realReviews: [{ title: "방문 후기", description: "현재 배달은 안 되고 매장 식사만 가능해요", link: "a" }] },
  };
  assert.equal(context.evidence(negative, false), null);

  const weak = {
    _imm: { verified: true, realReviews: [{ title: "방문 후기", description: "근처 배달 차량이 많았어요", link: "a" }] },
  };
  assert.equal(context.evidence(weak, false), null);
  assert.match(html, /후기에서 배달 언급/);
});
