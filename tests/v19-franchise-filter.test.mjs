import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const dataSource = fs.readFileSync(new URL("../franchise-data.js", import.meta.url), "utf8");
const logicSource = fs.readFileSync(new URL("../franchise.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(dataSource, context);
vm.runInContext(logicSource, context);
const classifier = context.IMMFranchise;

function classify(place, options = {}) {
  return classifier.classifyPlace(place, {
    mode: place.name ? "overseas" : "domestic",
    catalog: context.IMM_FRANCHISE_CATALOG,
    ...options,
  });
}

test("국내외 주요 프랜차이즈와 지역 체인을 구분한다", () => {
  assert.equal(classify({ id: "1", place_name: "스타벅스 강남R점" }).kind, "franchise");
  assert.equal(classify({ id: "1-reserve", name: "스타벅스 리저브 로스터리 도쿄" }).kind, "franchise");
  assert.equal(classify({ id: "2", place_name: "홍콩반점0410 분당정자점" }).kind, "franchise");
  assert.equal(classify({ id: "3", name: "Din Tai Fung Xinyi Branch" }).kind, "franchise");
  const regional = classify({ id: "4", place_name: "성심당 DCC점" });
  assert.equal(regional.kind, "chain");
  assert.equal(regional.confidence, "high");
});

test("근거가 없는 곳은 확정 대신 로컬 식당 추정으로 표시한다", () => {
  const result = classify({ id: "local", place_name: "골목 안 작은 밥집" });
  assert.equal(result.kind, "independent");
  assert.equal(result.confidence, "low");
  assert.match(result.reason, /단서 없음/);
});

test("후기와 현재 검색의 중복 상호를 지역 체인 보조 근거로 사용한다", () => {
  const reviewResult = classify({
    id: "review-chain",
    place_name: "동네국수 시청점",
    _reviews: [{ title: "다른 지점보다 좋아요", description: "지역 체인 중에서는 괜찮은 편" }],
  });
  assert.equal(reviewResult.kind, "chain");
  assert.equal(reviewResult.source, "reviews");

  const places = [
    { id: "a", place_name: "옛날집 강남점" },
    { id: "b", place_name: "옛날집 역삼점" },
  ];
  const observedCounts = classifier.buildObservedChainCounts(places);
  const observedResult = classify(places[0], { observedCounts });
  assert.equal(observedResult.kind, "chain");
  assert.equal(observedResult.source, "results");
});

test("사용자 수정은 장소와 모드별로 자동 판정보다 우선한다", () => {
  const place = { id: "manual", place_name: "스타벅스 테스트점" };
  const key = classifier.placeKey(place, "domestic");
  const result = classify(place, { overrides: { [key]: { kind: "independent" } } });
  assert.equal(result.kind, "independent");
  assert.equal(result.source, "user");
  assert.equal(result.userOverride, true);
});

test("결과 카드와 필터에 판정 근거·수정·프랜차이즈 제외 UI가 있다", () => {
  assert.match(html, /franchise-data\.js/);
  assert.match(html, /franchise\.js/);
  assert.match(html, /const FRANCHISE_OVERRIDE_KEY = "imm_franchise_overrides_v1"/);
  assert.match(html, /function refreshFranchiseClassifications\(\)/);
  assert.match(html, /function renderFranchiseRow\(card, p, opts = \{\}\)/);
  assert.match(html, /프랜차이즈 제외/);
  assert.match(html, /판정 수정/);
  assert.match(html, /자동 판정으로 복원/);
  assert.match(html, /p\._franchise\?\.kind === "franchise"/);
});

test("프랜차이즈 기능은 새 API나 Haiku 호출을 추가하지 않는다", () => {
  assert.doesNotMatch(dataSource + logicSource, /fetch\s*\(/);
  assert.doesNotMatch(dataSource + logicSource, /anthropic|claude/i);
});
