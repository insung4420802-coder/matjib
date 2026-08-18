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
        SortBy: { DISTANCE: "DISTANCE" },
        Places: class Places {
          keywordSearch(keyword, callback) {
            calls.push(keyword);
            callback(fixtures[keyword] || [], "OK");
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
  assert.deepEqual(calls, ["오징어짬뽕"]);
  assert.equal(result.length, 9);
  assert.ok(result.every((item) => item._sourceLevel === "exact"));
});

test("정확 후보가 부족할 때만 유사 검색으로 넓히고 최대 12곳을 남긴다", async () => {
  const { searchPlaces, calls } = makeSearch({
    "오징어짬뽕": places("exact", 2, 900),
    "해물짬뽕": places("broad", 10, 100),
    "중식": places("broader", 10, 10),
  });
  const result = await searchPlaces(plan, { lat: 37, lng: 127 }, 3000);
  assert.deepEqual(calls, ["오징어짬뽕", "해물짬뽕"]);
  assert.equal(result.length, 12);
  assert.deepEqual(result.slice(0, 2).map((item) => item._sourceLevel), ["exact", "exact"]);
});
