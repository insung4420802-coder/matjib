import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const logicSource = fs.readFileSync(new URL("../google-rating.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(logicSource, context);
const ratings = context.IMMGoogleRating;

test("평점 4.5 이상이고 참여 30개 이상이면 최상위로 분류한다", () => {
  assert.equal(ratings.tier({ rating: 4.5, ratingCount: 30 }).key, "top");
  assert.equal(ratings.tier({ rating: 4.8, ratingCount: 12 }).key, "excellent");
});

test("구글 평점 필터가 3.5, 4.0, 최상위 기준을 구분한다", () => {
  const place = { rating: 4.6, ratingCount: 29 };
  assert.equal(ratings.matchesFilter(place, "3.5"), true);
  assert.equal(ratings.matchesFilter(place, "4.0"), true);
  assert.equal(ratings.matchesFilter(place, "top"), false);
  assert.equal(ratings.matchesFilter({ rating: 4.6, ratingCount: 30 }, "top"), true);
});

test("구글 평점순은 평점을 우선하고 동점이면 참여 수를 사용한다", () => {
  const places = [
    { id: "a", rating: 4.4, ratingCount: 1000 },
    { id: "b", rating: 4.7, ratingCount: 20 },
    { id: "c", rating: 4.7, ratingCount: 200 },
  ];
  places.sort(ratings.compare);
  assert.deepEqual(places.map((place) => place.id), ["c", "b", "a"]);
});

test("해외 결과에 계층 카드, 전용 필터, 평점 정렬이 연결된다", () => {
  assert.match(html, /google-rating\.js/);
  assert.match(html, /Google · \$\{ratingTier\.label\}/);
  assert.match(html, /4\.5\+ · 30개\+/);
  assert.match(html, /구글 평점 높은 순/);
  assert.match(html, /IMMGoogleRating\.matchesFilter/);
  assert.match(html, /임슐랭 종합점수/);
});
