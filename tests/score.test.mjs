import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReviews,
  dedupeReviews,
  filterReviewsForPlace,
  evaluatePlace,
  evaluateOverseasPlace,
  reviewMatchesPlace,
  reviewSatisfaction,
  relevanceScore,
} from "../api/lib/_score.js";
import { combine, combineOverseas, toStars, rescoreWithRelevance } from "../ranking.js";

const NOW = new Date("2026-07-14T00:00:00Z").getTime();

function reviews(count, description) {
  return Array.from({ length: count }, (_, i) => ({
    title: `내돈내산 솔직 후기 ${i}`,
    description,
    date: "20260701",
    link: `https://blog.naver.com/sample/${i}`,
    blogger: `작성자${i}`,
  }));
}

function evaluate(items) {
  return evaluatePlace({
    rawRelevanceScore: 10,
    maxRelevanceScore: 10,
    reviews: items,
  }, NOW);
}

test("후기 0~1개에는 별점을 부여하지 않는다", () => {
  assert.equal(evaluate([]).stars, null);
  assert.equal(evaluate(reviews(1, "맛있고 만족해서 재방문")).stars, null);
});

test("진짜 후기 2개의 최고 별점은 4점이다", () => {
  assert.equal(evaluate(reviews(2, "정말 맛있고 최고라 만족, 재방문하고 또 갈 집")).stars, 4);
});

test("호평과 악평은 별점 방향이 분명히 다르다", () => {
  const positive = evaluate(reviews(8, "정말 맛있고 최고라 만족, 재방문하고 또 갈 집"));
  const negative = evaluate(reviews(8, "음식이 맛없고 별로였으며 실망, 다시 안 갈 예정"));
  assert.ok(positive.stars >= 4.5);
  assert.ok(negative.stars <= 2);
  assert.ok(positive.breakdown.satisfaction > negative.breakdown.satisfaction);
});

test("Claude의 강제 real 판정은 강한 협찬 문구도 실제로 덮어쓴다", () => {
  const source = { title: "체험단 후기", description: "제공받아 작성", forcedVerdict: "real" };
  const judged = classifyReviews([source]);
  assert.equal(judged.real.length, 1);
  assert.equal(judged.judged[0].isAd, false);
});

test("동일 블로그 링크의 중복 후기는 한 건으로 센다", () => {
  const items = [
    { title: "후기 A", link: "https://blog.naver.com/a/1?tracking=x", blogger: "a" },
    { title: "후기 A 재수집", link: "https://blog.naver.com/a/1?tracking=y", blogger: "a" },
  ];
  assert.equal(dedupeReviews(items).length, 1);
});

test("상호가 없는 목록성 글과 다른 매장 후기는 제외한다", () => {
  const items = [
    {
      title: "성남시 지역화폐 가맹점 알아보기",
      description: "갑오징어짬뽕 여러 매장 목록",
      link: "https://example.com/list",
    },
    {
      title: "판교 신승반점 판교점 내돈내산 후기",
      description: "탕수육과 짬뽕을 먹었다",
      link: "https://example.com/real",
    },
    {
      title: "공화춘 해물짬뽕 후기",
      description: "태그에 신승반점이 함께 언급됨",
      link: "https://example.com/other",
    },
  ];
  const filtered = filterReviewsForPlace(items, "신승반점 현대백화점판교점");
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].title, /신승반점/);
});

test("붙여 쓴 상호의 흔한 홍보 접두어는 제거해 실제 후기를 살린다", () => {
  const filtered = filterReviewsForPlace([{
    title: "판교 맛집 조박사 짬뽕짜장 내돈내산 후기",
    description: "직접 방문했다",
  }], "명품조박사짬뽕짜장");
  assert.equal(filtered.length, 1);
});

test("해외 평점 엔진은 구글 평점과 표본 수를 계속 사용한다", () => {
  const result = evaluateOverseasPlace({
    rating: 4.5,
    ratingCount: 1000,
    rawRelevanceScore: 10,
    maxRelevanceScore: 10,
    reviews: [],
  }, NOW);
  assert.equal(result.verified, true);
  assert.equal(result.googleRating, 4.5);
  assert.ok(result.stars >= 4);
});

test("같은 동네의 지점명만 일치한 다른 식당 글은 후기로 세지 않는다", () => {
  assert.equal(reviewMatchesPlace({ title: "을밀대 강남점 냉면 후기", description: "직접 먹었다" },
    "진미평양냉면 강남점"), false);
});

test("같은 브랜드라도 명시적으로 다른 지점의 후기는 제외한다", () => {
  assert.equal(reviewMatchesPlace({ title: "신승반점 강남점 내돈내산", description: "신승반점 현대백화점판교점과 비교" },
    "신승반점 현대백화점판교점"), false);
  assert.equal(reviewMatchesPlace({ title: "신승반점 판교점 내돈내산", description: "" },
    "신승반점 현대백화점판교점"), true);
});

test("제목에 브랜드만 있어도 요약에서 다른 지점의 식사를 명시하면 제외한다", () => {
  assert.equal(reviewMatchesPlace({ title: "홍콩반점 내돈내산 후기", description: "홍대점에서 짬뽕을 먹었다" },
    "홍콩반점 강남역점"), false);
  assert.equal(reviewMatchesPlace({ title: "홍콩반점 내돈내산 후기", description: "강남역점에서 짬뽕을 먹었다" },
    "홍콩반점 강남역점"), true);
});

test("다른 지점 단순 소개나 과거·비교 언급은 현재 지점 후기의 배제 사유가 아니다", () => {
  for (const description of [
    "홍대점도 운영 중이다", "홍대점에서 먹었던 맛과 비교하면 국물이 좋았다",
    "예전에 홍대점에서 먹었다. 이번에는 강남역점에서 식사했다",
    "홍대점에서 먹었고 강남역점에서 식사했다",
  ]) {
    assert.equal(reviewMatchesPlace({ title: "홍콩반점 내돈내산 후기", description }, "홍콩반점 강남역점"), true);
  }
  assert.equal(reviewMatchesPlace({ title: "홍콩반점 강남역점 후기", description: "홍대점에서 먹은 짬뽕도 생각났다" },
    "홍콩반점 강남역점"), true);
});

test("브랜드와 지점을 붙여 쓴 제목도 지점 축약을 인식한다", () => {
  assert.equal(reviewMatchesPlace({ title: "신승반점판교점 내돈내산", description: "" },
    "신승반점 현대백화점판교점"), true);
  assert.equal(reviewMatchesPlace({ title: "신승반점강남점 내돈내산", description: "" },
    "신승반점 현대백화점판교점"), false);
});

test("짧거나 일반적인 상호의 부분 일치는 신원 증거로 삼지 않는다", () => {
  assert.equal(reviewMatchesPlace({ title: "미소가 나오는 식당", description: "추천" }, "미소"), false);
  assert.equal(reviewMatchesPlace({ title: "국수 맛집 모음", description: "국수 먹었다" }, "국수"), false);
  assert.equal(reviewMatchesPlace({ title: "미소 방문 후기", description: "미소에서 직접 먹었다" }, "미소"), true);
});

test("해외 상호의 한글과 Unicode 문자는 보존하고 외국어 첫 단어만으로 일치시키지 않는다", () => {
  assert.equal(reviewMatchesPlace({ title: "오사카 이치란 난바점 후기" }, "이치란 난바점"), true);
  assert.equal(reviewMatchesPlace({ title: "Bánh Xèo Bà Dưỡng 직접 방문" }, "Bánh Xèo Bà Dưỡng"), true);
  assert.equal(reviewMatchesPlace({ title: "Bánh Xèo 다른 식당 후기" }, "Bánh Xèo Bà Dưỡng"), false);
  assert.equal(reviewMatchesPlace({ title: "一蘭 방문 후기", description: "一蘭에서 직접 먹었다" }, "一蘭"), true);
});

test("부정 표현 안의 긍정 단어는 만족도에 가산하지 않는다", () => {
  for (const text of ["맛있지 않았다", "친절하지 않았다", "불친절", "추천하지 않음", "만족스럽지 않았다"]) {
    assert.ok(reviewSatisfaction(text) < 0.4, text);
  }
  assert.ok(reviewSatisfaction("친절하고 만족해서 추천") > 0.8);
  assert.ok(reviewSatisfaction("재방문 의사 없음") < 0.4);
  assert.ok(reviewSatisfaction("재방문 의사가 없음") < 0.4);
  assert.ok(reviewSatisfaction("또 갈 생각은 없다") < 0.4);
});

test("광고 단서가 없는 일반 소개 글은 방문 후기로 확정하거나 광고로 세지 않는다", () => {
  const result = evaluate([
    { title: "식당 영업시간 정보", description: "매장 위치와 전화번호를 소개합니다", link: "https://example.com/intro" },
    ...reviews(2, "맛있어서 재방문"),
    { title: "체험단 후기", description: "제공받아 작성", link: "https://example.com/ad" },
  ]);
  assert.equal(result.realCount, 2);
  assert.equal(result.adCount, 1);
  assert.equal(result.uncertainCount, 1);
  assert.equal(result.uncertainReviews[0].reviewVerdict, "uncertain");
  assert.equal(result.totalReviews, result.realCount + result.adCount + result.uncertainCount);
});

test("내돈내산을 부정하는 표현 자체는 경험 신호로 쓰지 않는다", () => {
  const result = classifyReviews([{ title: "내돈내산 아닌 식당 소개", description: "" }]);
  assert.equal(result.real.length, 0);
  assert.equal(result.uncertain.length, 1);
});

test("해외 동일 조건에서 한국인 블로그 유무의 차이는 최대 5점이다", () => {
  const place = { rating: 4.6, ratingCount: 1000, absoluteRelevance: 0.8, reviews: [] };
  const local = evaluateOverseasPlace(place, NOW);
  const popular = evaluateOverseasPlace({ ...place, reviews: reviews(8, "직접 먹었고 재방문") }, NOW);
  assert.ok(popular.score100 - local.score100 <= 5);
  assert.equal(local.googleRating, 4.6);
  assert.equal(popular.googleRatingCount, 1000);
});

test("해외 높은 평점과 한국인 후기량만으로 메뉴가 맞는 식당을 앞서지 않는다", () => {
  const matching = evaluateOverseasPlace({ rating: 4.4, ratingCount: 1000, absoluteRelevance: 0.9, reviews: [] }, NOW);
  const mismatch = evaluateOverseasPlace({ rating: 4.9, ratingCount: 1000, absoluteRelevance: 0.2,
    reviews: reviews(8, "내돈내산 후기") }, NOW);
  assert.ok(matching.score100 > mismatch.score100);
});

test("절대 메뉴 적합도가 있으면 검색 후보 중 최고점이어도 과대평가하지 않는다", () => {
  assert.equal(relevanceScore(1, 1, 0.1), 0.1);
  assert.equal(relevanceScore(1, 1, 0), 0);
  assert.equal(relevanceScore(5, 10), 0.5);
  const result = evaluatePlace({ rawRelevanceScore: 1, maxRelevanceScore: 1, absoluteRelevance: 0.1,
    reviews: reviews(3, "직접 먹었다") }, NOW);
  assert.equal(result.breakdown.relevance, 0.1);
});

test("광고성 후기 제거로 국내 메뉴 적합도가 낮아지면 실제 종합점수도 내려간다", () => {
  const original = evaluatePlace({ absoluteRelevance: 0.9, reviews: reviews(5, "맛있어서 재방문") }, NOW);
  const originalSnapshot = structuredClone(original);
  const cleaned = rescoreWithRelevance(original, 0.2);
  assert.ok(cleaned.score100 < original.score100);
  assert.equal(cleaned.stars, original.stars);
  assert.equal(cleaned.breakdown.relevance, 0.2);
  assert.equal(cleaned.score100, combine({ ...original.breakdown, relevance: 0.2 }).score100);
  assert.deepEqual(original, originalSnapshot);
});

test("해외 정제된 적합도는 종합점수·종합별점에 반영하고 Google 원평점은 보존한다", () => {
  const original = evaluateOverseasPlace({ rating: 4.6, ratingCount: 1000, absoluteRelevance: 0.9, reviews: [] }, NOW);
  const cleaned = rescoreWithRelevance(original, 0.1, true);
  const expected = combineOverseas({ ...original.breakdown, relevance: 0.1 });
  assert.equal(cleaned.score100, expected.score100);
  assert.equal(cleaned.stars, toStars(expected.score100));
  assert.ok(cleaned.stars < original.stars);
  assert.equal(cleaned.googleRating, original.googleRating);
  assert.equal(cleaned.googleRatingCount, original.googleRatingCount);
});

test("판정 실패나 자료 없는 결과에 클라이언트 재계산으로 점수를 만들지 않는다", () => {
  const unavailable = { verified: false, score100: null, stars: null, breakdown: null };
  assert.equal(rescoreWithRelevance(unavailable, 0.9), unavailable);
  const malformed = { verified: true, score100: 10, breakdown: { relevance: 0.1 } };
  assert.equal(rescoreWithRelevance(malformed, 0.9), malformed);
  const original = evaluate(reviews(3, "재방문"));
  assert.equal(rescoreWithRelevance(original, NaN), original);
});
