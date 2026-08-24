import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("지도 기준점은 현재 위치와 지정 위치를 시각적으로 구분한다", () => {
  assert.match(html, /kind: "gps", label: "현재 내 위치"/);
  assert.match(html, /kind: "manual", label: manualCenter\.label/);
  assert.match(html, /center\.kind === "manual" \|\| center\.kind === "query"/);
  assert.match(html, /map-context-dot\.gps/);
  assert.match(html, /map-context-dot\.fixed/);
  assert.match(html, /현재 내 위치/);
  assert.match(html, /지정 위치/);
});

test("맛집 핀은 대응하는 목록 카드로 이동하고 강조한다", () => {
  assert.match(html, /function focusPlaceFromMap\(placeId\)/);
  assert.match(html, /focusPlaceFromMap\(p\.id\)/);
  assert.match(html, /card\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(html, /card\.classList\.add\("map-linked-highlight"\)/);
  assert.match(html, /card\.dataset\.placeId = String\(p\.id\)/);
});

test("목록 카드에서 해당 지도 핀으로 돌아갈 수 있다", () => {
  assert.match(html, /🗺 지도에서 보기/);
  assert.match(html, /function showPlaceOnMap\(p\)/);
  assert.match(html, /pendingMapPinId = String\(p\.id\)/);
  assert.match(html, /selectedMarker\.info\.open/);
  assert.match(html, /!b\.classList\.contains\("map-list-btn"\)/);
});

test("지도 연결은 기존 카카오·구글 지도 렌더 안에서 동작한다", () => {
  assert.match(html, /function renderResultMap\(list(?:, highlightChampion = champion)?\)/);
  assert.match(html, /async function renderResultMapOverseas\(list(?:, highlightChampion = champion)?\)/);
  assert.doesNotMatch(html, /function focusPlaceFromMap[\s\S]{0,500}apiFetch\(/);
});
