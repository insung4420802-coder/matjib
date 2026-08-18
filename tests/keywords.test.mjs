import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/keywords.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
  };
}

test("키워드 변환은 정확→유사→큰 분류 계획을 만들고 테마를 음식 조건에 섞지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          search: ["오징어짬뽕", "해물짬뽕", "짬뽕"],
          match: ["오징어짬뽕", "짬뽕", "아이랑"],
          food: [],
          theme: ["아이랑"],
          tiers: { exact: "오징어짬뽕", broad: "짬뽕", broader: "중식" },
          region: "",
          confidence: 0.94,
          needsClarification: false,
        }),
      }],
    }),
  });

  try {
    const req = { method: "POST", headers: {}, body: { query: "오징어 들어간 짬뽕" } };
    const res = responseRecorder();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.keywordPlan, [
      { keyword: "오징어짬뽕", level: "exact" },
      { keyword: "해물짬뽕", level: "broad" },
      { keyword: "짬뽕", level: "broad" },
    ]);
    assert.deepEqual(res.body.food, ["오징어짬뽕", "해물짬뽕", "짬뽕"]);
    assert.ok(!res.body.food.includes("아이랑"));
    assert.equal(res.body.confidence, 0.94);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
