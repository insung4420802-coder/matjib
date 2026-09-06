import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("async function searchPlaces");
const end = html.indexOf("/* ───────── 카드 렌더링", start);
if (start < 0 || end < 0) throw new Error("index.html에서 searchPlaces를 찾지 못했습니다.");
const source = html.slice(start, end);

function makeSearch(fixtures) {
  const calls = [];
  const kakao = {
    maps: {
      LatLng: class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
      services: {
        Status: { OK: "OK" },
        SortBy: { ACCURACY: "ACCURACY", DISTANCE: "DISTANCE" },
        Places: class Places {
          keywordSearch(keyword, callback, options) {
            calls.push({ keyword, ...options });
            const fixture = fixtures[keyword] || [];
            const result = Array.isArray(fixture) ? fixture : fixture[options.sort] || [];
            callback(result.slice(0, options.size), "OK");
          }
        },
      },
    },
  };
  const searchPlaces = new Function("kakao", `${source}; return searchPlaces;`)(kakao);
  return { searchPlaces, calls };
}

function places(prefix, count, distanceStart = 100) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    place_name: `${prefix}${index}`,
    distance: String(distanceStart + index),
  }));
}

const plan = [
  { keyword: "오징어짬뽕", level: "exact" },
  { keyword: "해물짬뽕", level: "broad" },
  { keyword: "중식", level: "broader" },
];

test("정확 검색에서 후보가 충분하면 넓은 검색을 호출하지 않는다", async () => {
  const { searchPlaces, calls } = makeSearch({ "오징어짬뽕": places("exact", 9) });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.deepEqual(calls.map(({ keyword, sort }) => [keyword, sort]), [
    ["오징어짬뽕", "ACCURACY"], ["오징어짬뽕", "DISTANCE"],
  ]);
  assert.equal(result.length, 9);
  assert.ok(result.every((item) => item._sourceLevel === "exact"));
});

test("정확 후보가 부족할 때만 유사 검색으로 넓히고 최대 20곳을 남긴다", async () => {
  const { searchPlaces, calls } = makeSearch({
    "오징어짬뽕": places("exact", 2, 900),
    "해물짬뽕": { ACCURACY: places("broad-relevant", 15, 100), DISTANCE: places("broad-near", 15, 10) },
    "중식": places("broader", 10, 10),
  });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.deepEqual(calls.map(({ keyword }) => keyword), ["오징어짬뽕", "오징어짬뽕", "해물짬뽕", "해물짬뽕"]);
  assert.equal(result.length, 20);
  assert.deepEqual(result.slice(0, 2).map((item) => item._sourceLevel), ["exact", "exact"]);
});

test("조금 멀어도 관련도 검색 상위의 정확 메뉴 식당이 가까운 후보에 밀려 사라지지 않는다", async () => {
  const farRelevant = { id: "far-relevant", place_name: "오징어짬뽕 전문점", distance: "2900" };
  const { searchPlaces } = makeSearch({
    "오징어짬뽕": {
      ACCURACY: [farRelevant, ...places("relevant", 14, 1000)],
      DISTANCE: places("nearby", 15, 10),
    },
  });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.equal(result.length, 20);
  assert.equal(result[0].id, farRelevant.id);
  assert.ok(result.some((item) => item.id.startsWith("nearby")));
});

test("정확도·거리 검색과 유사 검색의 같은 식당은 하나로 합치고 정확 메뉴 출처를 유지한다", async () => {
  const duplicate = { id: "same-place", place_name: "중복 식당", distance: "500" };
  const { searchPlaces } = makeSearch({
    "오징어짬뽕": { ACCURACY: [duplicate], DISTANCE: [duplicate] },
    "해물짬뽕": { ACCURACY: [duplicate, ...places("broad", 8)], DISTANCE: [duplicate] },
  });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.equal(result.filter((item) => item.id === duplicate.id).length, 1);
  assert.equal(result.find((item) => item.id === duplicate.id)._sourceLevel, "exact");
  assert.equal(new Set(result.map((item) => item.id)).size, result.length);
});

test("유사 검색까지 부족하면 같은 계열 검색을 하되 정확한 메뉴 후보는 우선 남긴다", async () => {
  const { searchPlaces, calls } = makeSearch({
    "오징어짬뽕": places("exact", 2, 2500),
    "해물짬뽕": places("broad", 2, 1000),
    "중식": places("broader", 10, 100),
  });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.equal(calls.length, 6);
  assert.equal(result.length, 14);
  assert.deepEqual(result.slice(0, 4).map((item) => item._sourceLevel), ["exact", "exact", "broad", "broad"]);
});

test("두 검색 모두 선택한 위치·반경·음식점 범위를 사용하고 반경 밖 결과를 제외한다", async () => {
  const center = { lat: 37.4, lng: 127.1 };
  const { searchPlaces, calls } = makeSearch({
    "오징어짬뽕": [
      { id: "within", distance: "2999" },
      { id: "edge", distance: "3000" },
      { id: "outside", distance: "3001" },
      { id: "unusable", distance: "unknown" },
    ],
  });
  const result = await searchPlaces(plan.slice(0, 1), center, 3000);
  assert.deepEqual(result.map((item) => item.id), ["within", "edge"]);
  for (const call of calls) {
    assert.deepEqual({ lat: call.location.lat, lng: call.location.lng }, center);
    assert.equal(call.radius, 3000);
    assert.equal(call.category_group_code, "FD6");
    assert.equal(call.size, 15);
  }
});
