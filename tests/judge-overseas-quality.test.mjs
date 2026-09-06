import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/judge-overseas.js";

async function judge(body) {
  const originalKey = process.env.APP_ACCESS_KEY;
  delete process.env.APP_ACCESS_KEY;
  const res = { statusCode: 200, body: null, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return value; } };
  try {
    await handler({ method: "POST", headers: {}, body }, res);
    return res;
  } finally {
    if (originalKey === undefined) delete process.env.APP_ACCESS_KEY;
    else process.env.APP_ACCESS_KEY = originalKey;
  }
}

test("해외 점수 API는 잘못된 식당·후기 항목을 건너뛰고 정상 후보는 반환한다", async () => {
  const res = await judge({ places: [null, "bad", [], {}, { id: "a", placeName: "이치란", rating: 4.5, ratingCount: 300,
    reviews: [null, "bad", [], { title: "이치란에서 먹었다", description: "직접 먹었고 맛있어서 재방문", link: "https://example.com/review" }] }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].id, "a");
  assert.equal(res.body.results[0].realCount, 1);
  assert.equal(res.body.results[0].googleRating, 4.5);
});

test("부정확한 숫자·점수 분모가 NaN 또는 null 점수를 만들지 않는다", async () => {
  for (const maxRelevanceScore of ["not a number", -5, {}, Infinity]) {
    const res = await judge({ maxRelevanceScore, places: [{ id: "a", rawRelevanceScore: "10", rating: "4.8", ratingCount: "300.9" },
      { id: "b", rawRelevanceScore: {}, rating: "Infinity", ratingCount: [] }] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.results[0].breakdown.relevance, 1);
    assert.equal(res.body.results[0].googleRatingCount, 300);
    for (const result of res.body.results) {
      assert.ok(Number.isFinite(result.score100));
      assert.ok(Object.values(result.breakdown).every(Number.isFinite));
    }
    assert.equal(res.body.results[1].googleRating, null);
    assert.equal(res.body.results[1].googleRatingCount, 0);
  }
});

test("후기 링크의 실행 가능한 URL과 사용자정보 URL을 반환하지 않는다", async () => {
  const res = await judge({ places: [{ id: "a", reviews: [
    { title: "먹었고 맛있었던 후기 1", link: "javascript:alert(1)" },
    { title: "직접 먹었던 후기 2", link: "https://name:secret@example.com/review" },
    { title: "맛있어 재방문한 후기 3", link: "https://example.com/review" },
  ] }] });
  assert.deepEqual(res.body.results[0].realReviews.map((item) => item.link), ["", "", "https://example.com/review"]);
});
