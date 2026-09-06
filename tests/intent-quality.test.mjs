import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/keywords.js";

async function run(query, payload, { mode, stopReason = "end_turn", noKey = false, httpOk = true } = {}) {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedAccess = process.env.APP_ACCESS_KEY;
  let request;
  delete process.env.APP_ACCESS_KEY;
  if (noKey) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = "mock-key";
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: httpOk, json: async () => ({ stop_reason: stopReason,
      content: [{ type: "text", text: JSON.stringify(payload) }] }) };
  };
  const res = { statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; } };
  try {
    await handler({ method: "POST", headers: {}, body: { query, mode } }, res);
    return { ...res.body, request, statusCode: res.statusCode };
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of [["ANTHROPIC_API_KEY", savedKey], ["APP_ACCESS_KEY", savedAccess]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("모델을 쓸 수 없어도 안 매운 국물 요청에 매운 메뉴를 자동 제안하지 않는다", async () => {
  const result = await run("안 매운 국물, 해산물 빼고", null, { noKey: true });
  assert.equal(result.converted, false);
  assert.equal(result.requiresMenuChoice, true);
  assert.deepEqual(result.constraints, ["맵지 않은 음식", "해산물 제외"]);
  assert.ok(result.menuCandidates.length >= 8);
  assert.ok(result.menuCandidates.every(({ label }) => !/짬뽕|마라|매운탕|육개장|김치찌개/.test(label)));
  assert.equal(result.request, undefined);
});

test("명시적 조건은 모델이 빠뜨려도 보존하고 큰 요리 분류 검색을 제거한다", async () => {
  const result = await run("오징어 들어간 짬뽕, 유아 의자와 주차 가능, 1인당 2만원 이하", {
    search: ["오징어짬뽕", "짬뽕", "중식", "해산물"],
    tiers: { exact: "오징어짬뽕", broad: "짬뽕", broader: "중식" },
    menuAliases: ["짬뽕", "오징어", "중식"], constraints: [], confidence: 0.95,
  });
  assert.deepEqual(result.constraints, ["오징어 포함", "유아 의자", "주차 가능", "1인당 2만원 이하"]);
  assert.deepEqual(result.keywords, ["오징어짬뽕", "짬뽕"]);
  assert.deepEqual(result.menuAliases, ["오징어짬뽕"]);
  assert.equal(result.requiresMenuChoice, false);
  assert.ok(result.request.system.includes("제외"));
});

test("해외도 확신도 0·명확화 필요·부정 조건을 보존하고 소바의 직접 번역만 허용한다", async () => {
  const result = await run("오사카 소바, 해산물 제외", {
    region: "Osaka, Japan", gquery: ["soba Osaka", "seafood Osaka"], krquery: "오사카 소바 맛집",
    match: ["소바", "soba", "seafood"], menuAliases: ["soba", "そば", "udon", "Japanese", "noodles"],
    menuCandidates: [{ label: "소바", query: "soba" }], tiers: { exact: "소바", broad: "면요리", broader: "일식" },
    confidence: 0, needsClarification: true,
  }, { mode: "overseas" });
  assert.equal(result.confidence, 0);
  assert.equal(result.needsClarification, true);
  assert.deepEqual(result.constraints, ["해산물 제외"]);
  assert.deepEqual(result.gquery, ["soba Osaka"]);
  assert.ok(result.menuAliases.includes("soba"));
  assert.ok(result.menuAliases.includes("そば"));
  assert.ok(!result.menuAliases.includes("udon"));
  assert.ok(!result.menuAliases.includes("Japanese"));
  assert.ok(!result.match.includes("seafood"));
});

test("최대 토큰에 걸린 응답은 부분 JSON이 완성돼 보여도 사용하지 않는다", async () => {
  const result = await run("맵지 않은 국물", {
    search: ["마라탕"], menuCandidates: [{ label: "마라탕", query: "마라탕" }], confidence: 1,
  }, { stopReason: "max_tokens" });
  assert.equal(result.converted, false);
  assert.ok(result.constraints.includes("맵지 않은 음식"));
  assert.ok(result.menuCandidates.every(({ label }) => label !== "마라탕"));
  assert.ok(result.request.max_tokens <= 1100);
});

test("잘못된 응답 형태와 필드 형식은 서버 오류 없이 원문 의도를 유지한다", async () => {
  for (const payload of [null, [], { search: [123, null, {}], tiers: { exact: 45 }, region: {} }, { search: ["라멘"], tiers: { exact: null }, confidence: "1", menuCandidates: [null, { label: {} }] }]) {
    const result = await run("해산물 없는 라멘", payload);
    assert.equal(result.statusCode, 200);
    assert.ok(result.constraints.includes("해산물 제외"));
    assert.equal(typeof result.tiers.exact, "string");
    assert.equal(typeof result.confidence, "number");
    assert.ok(result.keywords.includes("라멘"));
    assert.ok(result.menuCandidates.every(({ label, query }) => typeof label === "string" && typeof query === "string"));
  }
});

test("해외 모델 실패에도 영어 부정 조건을 보존한다", async () => {
  const result = await run("non-spicy soup without seafood", {}, { mode: "overseas", httpOk: false });
  assert.deepEqual(result.constraints, ["맵지 않은 음식", "해산물 제외"]);
  assert.equal(result.converted, false);
  assert.equal(result.requiresMenuChoice, true);
  assert.ok(result.menuCandidates.every(({ query }) => !/spicy|seafood|fish|shrimp/i.test(query)));
});

test("모델 실패 시 복합 메뉴명을 큰 종류로 잘라 버리지 않는다", async () => {
  const result = await run("차돌된장찌개, 주차는 필요 없어", null, { noKey: true });
  assert.deepEqual(result.keywords, ["차돌된장찌개"]);
  assert.deepEqual(result.menuAliases, ["차돌된장찌개"]);
  assert.ok(!result.constraints.includes("주차 가능"));
});

test("추상 요청의 모델 후보가 명시적 제외 조건에 어긋나면 걸러낸다", async () => {
  const result = await run("아이와 먹을 음식, 해산물 제외", {
    search: ["우동", "초밥"], constraints: [], requiresMenuChoice: true,
    menuCandidates: [{ label: "초밥", query: "초밥" }, { label: "우동", query: "우동" }, { label: "피자", query: "피자" }],
    confidence: 0.8,
  });
  assert.deepEqual(result.keywords, ["우동"]);
  assert.deepEqual(result.menuCandidates.map(({ label }) => label), ["우동", "피자"]);
  assert.equal(result.requiresMenuChoice, true);
});
