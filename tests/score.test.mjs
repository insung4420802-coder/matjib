import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReviews,
  dedupeReviews,
  evaluatePlace,
  evaluateOverseasPlace,
} from "../api/lib/score.js";

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
