import test from "node:test";
import assert from "node:assert/strict";
import { positiveMention, relevanceForPlace, acceptedReviews, evidenceSources, evidenceConflict, compareRecommendations } from "../search-quality.js";
import { reviewMatchesPlace } from "../review-identity.js";

const soba = { tiers: { exact: "소바", broad: "면요리", broader: "일식" }, menuAliases: ["소바", "soba", "そば"] };
const ramen = { tiers: { exact: "라멘", broad: "면요리", broader: "일식" }, menuAliases: ["라멘", "ramen", "ラーメン"] };
const blog = (index, patch = {}) => ({ title: `하루식당 직접 방문 ${index}`, description: `소바를 먹었어요. 방문 기록 ${index}`,
  link: `https://blog.naver.com/haru/${index}`, date: "20260801", ...patch });
const google = (index, patch = {}) => ({ author: `방문자 ${index}`, text: `Excellent soba. Visit ${index}`,
  url: `https://www.google.com/maps/reviews/${index}`, publishTime: "2026-08-01", ...patch });

test("메뉴 미판매·다른 메뉴라는 문장을 메뉴 판매 근거로 세지 않는다", () => {
  for (const [text, term] of [
    ["짬뽕은 안 팔아요", "짬뽕"], ["짬뽕이 아니라 우동입니다", "짬뽕"], ["There is no ramen", "ramen"],
    ["짬뽕 판매 안 합니다", "짬뽕"], ["짬뽕이 아니고 우동이에요", "짬뽕"],
    ["Ramen is not available here", "ramen"], ["They do not serve ramen", "ramen"],
  ]) assert.equal(positiveMention(text, term), false, text);
  assert.equal(positiveMention("짬뽕은 안 팔지만 우동을 먹었어요", "우동"), true);
  assert.equal(positiveMention("소바를 주문해서 먹었습니다", "소바"), true);
});

test("다른 지점 글은 동일 브랜드여도 해당 지점의 메뉴 근거에서 제외한다", () => {
  const place = { place_name: "홍콩반점 강남역점", category_name: "중식", _reviews: [
    { title: "홍콩반점 홍대점 후기", description: "짬뽕이 아주 맛있다", link: "https://example.com/wrong" },
  ] };
  assert.equal(reviewMatchesPlace(place._reviews[0], place.place_name), false);
  assert.equal(relevanceForPlace(place, { tiers: { exact: "짬뽕" }, menuAliases: ["짬뽕"] }).tier, "broader");
  assert.deepEqual(evidenceSources(place, { tiers: { exact: "짬뽕" } }), []);
  assert.equal(reviewMatchesPlace({ title: "홍콩반점 강남역점 후기", description: "짬뽕을 먹었다" }, place.place_name), true);
});

test("본문에 다른 지점만 명시된 브랜드 글도 해당 지점 후기가 아니다", () => {
  assert.equal(reviewMatchesPlace({ title: "홍콩반점 내돈내산", description: "홍대점에서 짬뽕을 먹었다" }, "홍콩반점 강남역점"), false);
});

test("소바 검색에서 우동과 일식 카테고리만으로 정확 메뉴 일치를 만들지 않는다", () => {
  const place = { place_name: "하루식당", category_name: "일식", reviews: [google(1, { text: "The udon was wonderful." })] };
  const relevance = relevanceForPlace(place, soba);
  assert.notEqual(relevance.tier, "exact");
  assert.ok(relevance.absolute < 0.5);
  const actual = relevanceForPlace({ ...place, reviews: [google(1, { text: "Fresh soba with excellent texture." })] }, soba);
  assert.equal(actual.tier, "exact");
  assert.ok(actual.absolute > relevance.absolute);
});

test("소바 글자가 포함돼도 야키소바를 메밀 소바의 정확 근거로 세지 않는다", () => {
  assert.equal(positiveMention("The yakisoba was wonderful", "soba"), false);
  assert.equal(positiveMention("야키소바를 먹었습니다", "소바"), false);
  assert.equal(positiveMention("소금 야끼소바를 먹고 맛과 분위기에 반했어요", "소바"), false);
  assert.equal(positiveMention("마제소바를 주문했습니다", "소바"), false);
  assert.equal(positiveMention("焼きそばを食べました", "そば"), false);
  assert.equal(positiveMention("중화소바가 맛있어요", "소바"), false);
  assert.equal(positiveMention("메밀소바를 먹었습니다", "소바"), true);
  assert.equal(positiveMention("야키소바 대신 소바를 주문했어요", "소바"), true);
});

test("한국어 블로그가 없어도 Google 현지 후기에서 메뉴 근거를 수집한다", () => {
  const place = { name: "Haru Kitchen", reviews: [google(1), google(2)], _reviews: [],
    mapUrl: "https://maps.google.com/?cid=123" };
  assert.equal(relevanceForPlace(place, soba).tier, "exact");
  const sources = evidenceSources(place, soba, "overseas");
  assert.equal(sources.length, 2);
  assert.ok(sources.every((source) => source.kind === "google" && source.text.includes("soba")));
  assert.deepEqual(sources.map(({ url }) => url), place.reviews.map(({ url }) => url));
});

test("번역이 메뉴 이름을 바꿔도 해외 후기 원문의 정확 메뉴와 증거를 유지한다", () => {
  const place = { name: "Haru Kitchen", reviews: [google(1, { text: "The soba was wonderful.", textKo: "메밀국수가 훌륭했습니다." })] };
  assert.equal(relevanceForPlace(place, soba).tier, "exact");
  assert.ok(evidenceSources(place, soba, "overseas")[0].text.includes("soba"));
});

test("검색 API의 정확검색 경로만 있으면 검토 후보로 남기되 정확 메뉴 근거를 만들지 않는다", () => {
  const result = relevanceForPlace({ name: "하루식당", category: "음식점", _sourceLevel: "exact" }, soba);
  assert.equal(result.absolute, 0.1);
  assert.notEqual(result.tier, "exact");
});

test("근거 출처는 장소당 최대 3개이며 국내는 블로그만 전달한다", () => {
  const place = { place_name: "하루식당", _reviews: [1, 2, 3, 4, 5].map((index) => blog(index)), reviews: [1, 2, 3].map((index) => google(index)) };
  const domestic = evidenceSources(place, soba, "domestic");
  assert.equal(domestic.length, 3);
  assert.ok(domestic.every((source) => source.kind === "blog"));
  assert.ok(evidenceSources(place, soba, "overseas").length <= 3);
});

test("근거 URL은 실제로 해석 가능한 HTTP(S) 주소만 허용한다", () => {
  const badUrls = ["javascript:alert(1)", "data:text/plain,test", "https://", "https://bad host.example/path", "http://[invalid", "//example.com/review"];
  const place = { place_name: "하루식당", _reviews: badUrls.map((link, index) => blog(index, { link })) };
  assert.deepEqual(evidenceSources(place, soba, "domestic"), []);
});

test("출처가 있으면 Google 2개·한국어 블로그 1개를 균형 있게 선택한다", () => {
  const place = { place_name: "하루식당", reviews: [1, 2, 3, 4].map((index) => google(index)),
    _reviews: [blog(0, { link: "javascript:bad", date: "20260901" }), blog(1)] };
  const sources = evidenceSources(place, soba, "overseas");
  assert.equal(sources.length, 3);
  assert.equal(sources.filter((source) => source.kind === "google").length, 2);
  assert.equal(sources.filter((source) => source.kind === "blog").length, 1);
});

test("중복 후기와 내용 없는 출처를 여러 근거로 부풀리지 않는다", () => {
  const source = blog(1);
  const place = { place_name: "하루식당", _reviews: [source, source, blog(2, { description: "" })],
    reviews: [google(1), google(2, { text: google(1).text }), google(3, { text: "" })] };
  const sources = evidenceSources(place, soba, "overseas");
  assert.equal(sources.length, 2);
  assert.deepEqual(new Set(sources.map(({ kind }) => kind)), new Set(["blog", "google"]));
});

test("광고로 판정된 후기는 메뉴 검증에 다시 포함하지 않는다", () => {
  const real = blog(1), uncertain = blog(2), ad = blog(3);
  const place = { place_name: "하루식당", _reviews: [real, uncertain, ad],
    _imm: { verified: true, realReviews: [real], uncertainReviews: [uncertain], adReviews: [ad] } };
  assert.deepEqual(acceptedReviews(place), [real, uncertain]);
  const sources = evidenceSources(place, soba, "domestic");
  assert.equal(sources.length, 2);
  assert.ok(!sources.some(({ url }) => url === ad.link));
});

test("메뉴 또는 필수조건의 반대 근거가 발견되면 평점이 높아도 추천에서 뒤로 보낸다", () => {
  const supported = { id: "supported", _tier: "exact", _evidence: { menuStatus: "supported" }, _imm: { score100: 50 } };
  const unknown = { id: "unknown", _tier: "exact", _imm: { score100: 90 } };
  const contradicted = { id: "contradicted", _tier: "exact", _evidence: { menuStatus: "contradicted" }, _imm: { score100: 100 } };
  const constraintConflict = { id: "constraint", _tier: "exact", _evidence: { menuStatus: "supported", constraints: [{ status: "contradicted" }] }, _imm: { score100: 99 } };
  assert.equal(evidenceConflict(contradicted), true);
  assert.equal(evidenceConflict(constraintConflict), true);
  assert.equal(evidenceConflict(unknown), false);
  const sorted = [contradicted, unknown, constraintConflict, supported].sort(compareRecommendations);
  assert.deepEqual(sorted.slice(0, 2).map(({ id }) => id), ["supported", "unknown"]);
  assert.ok(sorted.slice(2).every(evidenceConflict));
});

test("후기나 URL이 없으면 메뉴·상호만으로 가짜 출처를 만들지 않는다", () => {
  assert.deepEqual(evidenceSources({ name: "Excellent Ramen", rating: 5, ratingCount: 500 }, ramen, "overseas"), []);
  assert.deepEqual(evidenceSources({ name: "Excellent Ramen", reviews: [{ text: "Excellent ramen" }] }, ramen, "overseas"), []);
});
