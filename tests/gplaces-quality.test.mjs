import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/gplaces.js";

const jsonResponse = (body) => ({ ok: true, json: async () => body });
const place = (id = "p1", extra = {}) => ({ id, displayName: { text: `식당 ${id}` }, location: { latitude: 34.66, longitude: 135.5 }, googleMapsUri: `https://maps.google.com/?cid=${id}`, businessStatus: "OPERATIONAL", ...extra });
const review = (text, extra = {}) => ({ originalText: { text, languageCode: "ja" }, rating: 5, ...extra });
const query = (extra = {}) => ({ query: "오사카 라멘", lat: "34.66", lng: "135.5", radius: "1000", ...extra });

async function run(input, fetcher, apiKey = "") {
  const oldFetch = globalThis.fetch;
  const envNames = ["GOOGLE_MAPS_API_KEY", "ANTHROPIC_API_KEY", "APP_ACCESS_KEY", "ANTHROPIC_MODEL"];
  const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.GOOGLE_MAPS_API_KEY = "google-test-key";
  process.env.ANTHROPIC_API_KEY = apiKey;
  process.env.ANTHROPIC_MODEL = "claude-haiku-4-5";
  delete process.env.APP_ACCESS_KEY;
  globalThis.fetch = fetcher;
  const res = { statusCode: 200, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return value; } };
  try {
    await handler({ method: "GET", query: input, headers: {} }, res);
    return res;
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of envNames) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
}

test("좁은 반경도 거리순 선별 대신 메뉴 관련성으로 최대 20곳을 조회한다", async () => {
  const result = await run(query(), async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.rankPreference, "RELEVANCE");
    assert.equal(body.maxResultCount, 20);
    assert.equal(body.locationBias.circle.radius, 1000);
    assert.match(options.headers["X-Goog-FieldMask"], /places.businessStatus/);
    return jsonResponse({ places: [place()] });
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.places.length, 1);
});

test("지역 좌표 조회가 실패하면 전세계 검색으로 확대하지 않는다", async () => {
  for (const response of [{ places: [] }, { places: [{ location: { latitude: null, longitude: null } }] }, { places: [{ location: { latitude: 95, longitude: 135 } }] }]) {
    let calls = 0;
    const result = await run({ query: "라멘", region: "알 수 없는 도시", lat: null, lng: null }, async (url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).textQuery, "알 수 없는 도시");
      return jsonResponse(response);
    });
    assert.equal(calls, 1);
    assert.equal(result.statusCode, 422);
    assert.equal(result.body.code, "REGION_NOT_FOUND");
    assert.deepEqual(result.body.places, []);
  }
});

test("누락된 좌표는 0,0으로 만들지 않고 명시적 0도 좌표는 허용한다", async () => {
  const noCoords = await run({ query: "라멘" }, async (url, options) => {
    assert.equal(JSON.parse(options.body).locationBias, undefined);
    return jsonResponse({ places: [] });
  });
  assert.equal(noCoords.body.center, null);
  for (const [lat, lng] of [[null, null], ["", ""], [[], []], ["NaN", "135"], ["35", undefined]]) {
    const invalid = await run({ query: "라멘", lat, lng }, async () => { throw new Error("invalid coordinates must not request Google"); });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_LOCATION");
  }
  const zero = await run(query({ lat: "0", lng: "0" }), async () => jsonResponse({ places: [] }));
  assert.deepEqual(zero.body.center, { lat: 0, lng: 0 });
});

test("영구 폐업은 후보에서 제외하고 임시 휴업과 상태 정보는 보존한다", async () => {
  const result = await run(query(), async () => jsonResponse({ places: [place("closed", { businessStatus: "CLOSED_PERMANENTLY" }), place("temporary", { businessStatus: "CLOSED_TEMPORARILY" }), place("open", { currentOpeningHours: { openNow: null } })] }));
  assert.deepEqual(result.body.places.map((item) => item.id), ["temporary", "open"]);
  assert.equal(result.body.places[0].businessStatus, "CLOSED_TEMPORARILY");
  assert.equal(result.body.places[1].openNow, null);
});

test("Google의 한국어 번역·후기 원문 주소·작성일을 재사용해 추가 번역을 생략한다", async () => {
  let calls = 0;
  const result = await run(query(), async (url) => {
    calls++;
    assert.match(url, /places.googleapis.com/);
    return jsonResponse({ places: [place("p1", { reviews: [review("とても美味しいラーメンです。", { text: { text: "정말 맛있는 라멘입니다.", languageCode: "ko" }, googleMapsUri: "https://maps.google.com/review/123", publishTime: "2026-08-30T12:00:00Z" })] })] });
  }, "haiku-test-key");
  const item = result.body.places[0].reviews[0];
  assert.equal(calls, 1);
  assert.equal(item.textKo, "정말 맛있는 라멘입니다.");
  assert.equal(item.text, "とても美味しいラーメンです。");
  assert.equal(item.url, "https://maps.google.com/review/123");
  assert.equal(item.publishTime, "2026-08-30T12:00:00Z");
});

test("추가 번역은 식당을 순환하며 최대 8개만 Haiku 한 번에 요청한다", async () => {
  let aiCalls = 0;
  const result = await run(query(), async (url, options) => {
    if (url.includes("places.googleapis.com")) return jsonResponse({ places: Array.from({ length: 10 }, (_, pi) => place(`p${pi}`, { reviews: Array.from({ length: 5 }, (_, ri) => review(`review-p${pi}-${ri}-` + "a".repeat(400))) })) });
    aiCalls++;
    const body = JSON.parse(options.body);
    const items = JSON.parse(body.messages[0].content);
    assert.equal(body.model, "claude-haiku-4-5");
    assert.equal(body.max_tokens, 1500);
    assert.equal(items.length, 8);
    assert.ok(items.every((item) => item.length <= 240));
    items.forEach((item, index) => assert.ok(item.startsWith(`review-p${index}-0-`)));
    return jsonResponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(items.map((_, index) => `번역 ${index}`)) }] });
  }, "haiku-test-key");
  assert.equal(aiCalls, 1);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.places[7].reviews[0].textKo, "번역 7");
  assert.equal(result.body.places[0].reviews[0].textKoPartial, true);
  assert.equal(result.body.places[0].reviews[1].textKo, undefined);
});

test("잘린 번역·개수 불일치·타입 오류가 원문 후기나 검색 결과를 없애지 않는다", async () => {
  const badResponses = [
    { stop_reason: "max_tokens", content: [{ type: "text", text: '["번역"]' }] },
    { content: [{ type: "text", text: '["번역", "다른 식당"]' }] },
    { content: [{ type: "text", text: '[{"text":"번역"}]' }] },
    { content: [{ type: "text", text: '["잘린 응답' }] },
  ];
  for (const aiResponse of badResponses) {
    const result = await run(query(), async (url) => url.includes("places.googleapis.com") ? jsonResponse({ places: [place("p1", { reviews: [review("美味しいラーメンです。")] })] }) : jsonResponse(aiResponse), "haiku-test-key");
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.places[0].reviews[0].text, "美味しいラーメンです。");
    assert.equal(result.body.places[0].reviews[0].textKo, undefined);
  }
});

test("영업시간·자동완성·상세·주소검색 모드를 유지한다", async () => {
  const hours = await run({ query: "가게 주소", mode: "hours" }, async () => jsonResponse({ places: [place("p1", { currentOpeningHours: { openNow: true } })] }));
  assert.equal(hours.body.found, true);
  assert.equal(hours.body.openNow, true);
  const autocomplete = await run({ query: "오사카", mode: "autocomplete" }, async () => jsonResponse({ suggestions: [{ placePrediction: { placeId: "osaka", text: { text: "오사카" } } }] }));
  assert.equal(autocomplete.body.suggestions[0].placeId, "osaka");
  const detail = await run({ query: "osaka", mode: "detail" }, async () => jsonResponse(place("osaka")));
  assert.equal(detail.body.place.lat, 34.66);
  const invalidDetail = await run({ query: "osaka", mode: "detail" }, async () => jsonResponse({ id: "osaka", location: { latitude: null, longitude: null } }));
  assert.equal(invalidDetail.statusCode, 404);
  const locate = await run({ query: "오사카", mode: "locate" }, async () => jsonResponse({ places: [place("good"), place("bad", { location: null })] }));
  assert.deepEqual(locate.body.places.map((item) => item.id), ["good"]);
});
